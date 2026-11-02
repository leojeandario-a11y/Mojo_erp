import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { hasEntityPermission } from "@/lib/permissions";

const statusSchema = z.object({
  status: z.enum(["ordered", "received"]),
}).strict();

class PurchaseStatusError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Invalid purchase request." }, { status: 400 });
  }
  const parsed = statusSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid purchase status." }, { status: 400 });

  try {
    await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const result = await client.query<{
        entity_id: string;
        requester_id: string;
        status: string;
      }>(
        `SELECT entity_id, requester_id, status
         FROM purchase_requests WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (!result.rowCount) throw new PurchaseStatusError("Purchase request not found.", 404);
      const purchase = result.rows[0];
      const isRequester = purchase.requester_id === actor.id;
      const permissionName = isRequester ? "finance.transaction.create" : "approvals.approve";
      if (!hasEntityPermission(actor, permissionName, purchase.entity_id)) {
        throw new PurchaseStatusError("Permission denied for this entity.", 403);
      }
      const permission = await client.query<{ allowed: boolean }>(
        "SELECT app_has_entity_permission($1, $2::uuid) AS allowed",
        [permissionName, purchase.entity_id],
      );
      if (permission.rows[0]?.allowed !== true) {
        throw new PurchaseStatusError("Permission denied for this entity.", 403);
      }

      const previousStatus = parsed.data.status === "ordered" ? "approved" : "ordered";
      if (purchase.status !== previousStatus) {
        throw new PurchaseStatusError(
          parsed.data.status === "ordered"
            ? "Only approved purchase requests can be marked ordered."
            : "Only ordered purchases can be marked received.",
          409,
        );
      }
      const update = await client.query(
        "UPDATE purchase_requests SET status = $2 WHERE id = $1 AND status = $3",
        [id, parsed.data.status, previousStatus],
      );
      if (!update.rowCount) throw new PurchaseStatusError("The purchase status changed; reload and try again.", 409);
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof PurchaseStatusError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Unable to update purchase request status.", error);
    return NextResponse.json({ error: "Unable to update purchase request status." }, { status: 500 });
  }
}
