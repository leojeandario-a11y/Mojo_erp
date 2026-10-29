import "server-only";
import type { PoolClient } from "pg";

export interface ApprovalStep {
  step_order: number;
  label: string;
  approver_role_id: string | null;
  approver_user_id: string | null;
  min_amount_usd: string | null;
}

export async function getNextApprovalStep(
  client: PoolClient,
  workflowId: string,
  afterStep: number,
  amountUsd: string,
): Promise<ApprovalStep | null> {
  const result = await client.query<ApprovalStep>(
    `SELECT step_order, label, approver_role_id, approver_user_id, min_amount_usd::text
     FROM approval_workflow_steps
     WHERE workflow_id = $1
       AND step_order > $2
       AND (min_amount_usd IS NULL OR min_amount_usd <= $3::numeric)
     ORDER BY step_order
     LIMIT 1`,
    [workflowId, afterStep, amountUsd],
  );
  return result.rows[0] ?? null;
}

export async function isAssignedApprover(
  client: PoolClient,
  userId: string,
  entityId: string,
  step: ApprovalStep,
): Promise<boolean> {
  if (step.approver_user_id === userId) return true;
  if (!step.approver_role_id) return false;
  const result = await client.query<{ assigned: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM user_roles ur
       WHERE ur.user_id = $1
         AND ur.role_id = $2
         AND (ur.entity_id IS NULL OR ur.entity_id = $3)
     ) AS assigned`,
    [userId, step.approver_role_id, entityId],
  );
  return result.rows[0]?.assigned === true;
}

export async function notifyApprovalUsers(
  client: PoolClient,
  userIds: string[],
  content: {
    kind: "approval_needed" | "system";
    title: { fr: string; ht: string; en: string };
    body: { fr: string; ht: string; en: string };
    link: string;
    refTable: string;
    refId: string;
  },
) {
  if (userIds.length === 0) return 0;
  const result = await client.query(
    `INSERT INTO notifications(user_id, kind, title, body, link, ref_table, ref_id)
     SELECT u.id, $2,
            CASE u.locale WHEN 'ht' THEN $4 WHEN 'en' THEN $5 ELSE $3 END,
            CASE u.locale WHEN 'ht' THEN $7 WHEN 'en' THEN $8 ELSE $6 END,
            $9, $10, $11
     FROM users u
     WHERE u.id = ANY($1::uuid[]) AND u.is_active`,
    [
      userIds,
      content.kind,
      content.title.fr,
      content.title.ht,
      content.title.en,
      content.body.fr,
      content.body.ht,
      content.body.en,
      content.link,
      content.refTable,
      content.refId,
    ],
  );
  return result.rowCount ?? 0;
}

export async function getStepApproverIds(
  client: PoolClient,
  step: ApprovalStep,
  entityId: string,
): Promise<string[]> {
  const result = await client.query<{ id: string }>(
    `SELECT DISTINCT u.id
     FROM users u
     WHERE u.is_active
       AND (
         u.id = $1
         OR (
           $2::uuid IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM user_roles ur
             WHERE ur.user_id = u.id
               AND ur.role_id = $2
               AND (ur.entity_id IS NULL OR ur.entity_id = $3)
           )
         )
       )
       AND (
         EXISTS (
           SELECT 1 FROM user_roles ur
           JOIN role_permissions rp ON rp.role_id = ur.role_id
           JOIN permissions p ON p.id = rp.permission_id
           WHERE ur.user_id = u.id
             AND ur.entity_id IS NULL
             AND p.code IN ('approvals.approve', '*')
         )
         OR EXISTS (
           SELECT 1 FROM user_roles ur
           JOIN role_permissions rp ON rp.role_id = ur.role_id
           JOIN permissions p ON p.id = rp.permission_id
           WHERE ur.user_id = u.id
             AND ur.entity_id = $3
             AND p.code = 'approvals.approve'
         )
       )`,
    [step.approver_user_id, step.approver_role_id, entityId],
  );
  return result.rows.map(({ id }) => id);
}
