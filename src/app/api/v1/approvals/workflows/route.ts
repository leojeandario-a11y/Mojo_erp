import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession, hasPermission } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { hasEntityPermission } from "@/lib/permissions";

const thresholdSchema = z.string()
  .regex(/^\d{1,16}(?:\.\d{1,2})?$/)
  .refine((value) => Number(value) >= 0)
  .nullable();

const updateWorkflowSchema = z.object({
  name: z.string().trim().min(2).max(120),
  isActive: z.boolean(),
  steps: z.array(z.object({
    label: z.string().trim().min(1).max(120),
    approverRoleId: z.uuid().nullable(),
    approverUserId: z.uuid().nullable(),
    minAmountUsd: thresholdSchema,
  }).strict().refine((step) => (step.approverRoleId !== null) !== (step.approverUserId !== null), {
    message: "Choose exactly one approver role or user.",
  })).min(1).max(20),
}).strict();

class WorkflowPolicyError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function GET(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!hasPermission(actor, "approvals.configure")
    && !Object.values(actor.entityPermissions).some((permissions) => permissions.includes("approvals.configure"))) {
    return NextResponse.json({ error: "Permission denied." }, { status: 403 });
  }

  try {
    const data = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const workflows = await client.query<{
        id: string;
        request_type: string;
        entity_id: string | null;
        entity_name: string | null;
        name: string;
        is_active: boolean;
      }>(
        `SELECT aw.id, aw.request_type, aw.entity_id, e.name AS entity_name, aw.name, aw.is_active
         FROM approval_workflows aw
         LEFT JOIN entities e ON e.id = aw.entity_id
         WHERE (aw.entity_id IS NULL AND $1::boolean)
            OR (aw.entity_id IS NOT NULL AND app_has_entity_permission('approvals.configure', aw.entity_id))
         ORDER BY aw.request_type, e.name NULLS FIRST`,
        [hasPermission(actor, "approvals.configure")],
      );
      const workflowIds = workflows.rows.map(({ id }) => id);
      const steps = workflowIds.length
        ? await client.query<{
          id: string;
          workflow_id: string;
          step_order: number;
          label: string;
          approver_role_id: string | null;
          approver_user_id: string | null;
          min_amount_usd: string | null;
        }>(
          `SELECT id, workflow_id, step_order, label, approver_role_id, approver_user_id,
                  min_amount_usd::text
           FROM approval_workflow_steps
           WHERE workflow_id = ANY($1::uuid[])
           ORDER BY workflow_id, step_order`,
          [workflowIds],
        )
        : { rows: [] };
      const roles = await client.query<{ id: string; name: string }>(
        "SELECT id, name FROM roles ORDER BY name",
      );
      const users = await client.query<{ id: string; full_name: string }>(
        "SELECT id, full_name FROM users WHERE is_active ORDER BY full_name",
      );
      return {
        workflows: workflows.rows.map((workflow) => ({
          ...workflow,
          steps: steps.rows.filter((step) => step.workflow_id === workflow.id),
        })),
        roles: roles.rows,
        users: users.rows,
      };
    });
    return NextResponse.json(data);
  } catch (error) {
    console.error("Unable to load approval workflows.", error);
    return NextResponse.json({ error: "Unable to load approval workflows." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const workflowId = new URL(request.url).searchParams.get("id");
  if (!workflowId || !z.uuid().safeParse(workflowId).success) {
    return NextResponse.json({ error: "Invalid approval workflow." }, { status: 400 });
  }
  const parsed = updateWorkflowSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid approval workflow details." }, { status: 400 });

  try {
    await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const workflowResult = await client.query<{ entity_id: string | null }>(
        "SELECT entity_id FROM approval_workflows WHERE id = $1 FOR UPDATE",
        [workflowId],
      );
      const workflow = workflowResult.rows[0];
      if (!workflow) throw new WorkflowPolicyError("Approval workflow not found.", 404);
      const allowed = workflow.entity_id === null
        ? hasPermission(actor, "approvals.configure")
        : hasEntityPermission(actor, "approvals.configure", workflow.entity_id);
      if (!allowed) throw new WorkflowPolicyError("Permission denied for this workflow.", 403);
      if (workflow.entity_id !== null) {
        const permission = await client.query<{ allowed: boolean }>(
          "SELECT app_has_entity_permission('approvals.configure', $1::uuid) AS allowed",
          [workflow.entity_id],
        );
        if (permission.rows[0]?.allowed !== true) {
          throw new WorkflowPolicyError("Permission denied for this workflow.", 403);
        }
      }

      const pendingResult = await client.query(
        "SELECT 1 FROM approval_requests WHERE workflow_id = $1 AND status = 'pending' LIMIT 1",
        [workflowId],
      );
      if (pendingResult.rowCount) {
        throw new WorkflowPolicyError("Resolve pending requests before changing this workflow.", 409);
      }

      const roleIds = [...new Set(parsed.data.steps.flatMap(({ approverRoleId }) => approverRoleId ? [approverRoleId] : []))];
      const userIds = [...new Set(parsed.data.steps.flatMap(({ approverUserId }) => approverUserId ? [approverUserId] : []))];
      if (roleIds.length) {
        const roles = await client.query(
          "SELECT id FROM roles WHERE id = ANY($1::uuid[])",
          [roleIds],
        );
        if (roles.rowCount !== roleIds.length) {
          throw new WorkflowPolicyError("One or more selected roles do not exist.", 400);
        }
      }
      if (userIds.length) {
        const users = await client.query(
          "SELECT id FROM users WHERE id = ANY($1::uuid[]) AND is_active",
          [userIds],
        );
        if (users.rowCount !== userIds.length) {
          throw new WorkflowPolicyError("One or more selected users are not active.", 400);
        }
      }

      await client.query(
        "UPDATE approval_workflows SET name = $2, is_active = $3 WHERE id = $1",
        [workflowId, parsed.data.name, parsed.data.isActive],
      );
      await client.query("DELETE FROM approval_workflow_steps WHERE workflow_id = $1", [workflowId]);
      for (const [index, step] of parsed.data.steps.entries()) {
        await client.query(
          `INSERT INTO approval_workflow_steps(
             workflow_id, step_order, label, approver_role_id, approver_user_id, min_amount_usd
           )
           VALUES ($1, $2, $3, $4, $5, $6::numeric)`,
          [
            workflowId,
            index + 1,
            step.label,
            step.approverRoleId,
            step.approverUserId,
            step.minAmountUsd,
          ],
        );
      }
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof WorkflowPolicyError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Unable to update approval workflow.", error);
    return NextResponse.json({ error: "Unable to update approval workflow." }, { status: 500 });
  }
}
