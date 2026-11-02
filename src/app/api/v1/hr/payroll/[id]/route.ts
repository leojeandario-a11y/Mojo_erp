import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";

const actionSchema = z.object({
  action: z.enum(["submit", "approve_daf", "approve_dg", "reject", "pay"]),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { id } = await context.params;
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid payroll action." }, { status: 400 });
  try {
    return await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const permissions = await client.query<{ manage: boolean; approve: boolean }>(
        `SELECT app_has_permission('hr.salary.manage') AS manage,
                app_has_permission('approval.approve') AS approve`,
      );
      if (!permissions.rows[0]?.manage) return NextResponse.json({ error: "Permission denied." }, { status: 403 });
      const run = await client.query<{ status: string; entity_id: string; period_end: string }>(
        "SELECT status,entity_id,period_end::text FROM payroll_runs WHERE id=$1", [id],
      );
      if (!run.rows[0]) return NextResponse.json({ error: "Payroll run not found." }, { status: 404 });
      const current = run.rows[0];
      let nextStatus = current.status;
      if (parsed.data.action === "submit" && current.status === "draft") nextStatus = "pending_approval";
      else if (parsed.data.action === "approve_daf" && current.status === "pending_approval" && permissions.rows[0]?.approve) nextStatus = "pending_dg";
      else if (parsed.data.action === "approve_dg" && current.status === "pending_dg" && permissions.rows[0]?.approve) nextStatus = "approved";
      else if (parsed.data.action === "reject" && ["pending_approval","pending_dg"].includes(current.status)) nextStatus = "draft";
      else if (parsed.data.action === "pay" && current.status === "approved") {
        const total = await client.query<{ total: string }>(
          "SELECT COALESCE(sum(net_amount),0)::text AS total FROM payroll_entries WHERE payroll_run_id=$1", [id],
        );
        const currency = await client.query<{ currency: string }>(
          "SELECT currency FROM payroll_entries WHERE payroll_run_id=$1 LIMIT 1", [id],
        );
        const account = await client.query<{ id: string }>(
          `SELECT id FROM accounts WHERE entity_id=$1 AND is_active ORDER BY created_at LIMIT 1`, [current.entity_id],
        );
        if (!account.rows[0]) return NextResponse.json({ error: "No active finance account is configured for this entity." }, { status: 409 });
        const transaction = await client.query<{ id: string }>(
          `INSERT INTO transactions(entity_id,tx_type,tx_date,account_id,amount,currency,fx_rate_to_usd,description,source_table,source_id,status,created_by)
           VALUES($1,'expense',$2,$3,$4,$5,1,'Payroll run ' || $6,'payroll_runs',$6,'draft',$7) RETURNING id`,
          [current.entity_id, current.period_end, account.rows[0].id, total.rows[0].total, currency.rows[0]?.currency ?? "USD", id, actor.id],
        );
        await client.query(
          "UPDATE payroll_entries SET transaction_id=$2,paid_at=$3 WHERE payroll_run_id=$1",
          [id, transaction.rows[0].id, current.period_end],
        );
        nextStatus = "paid";
      } else return NextResponse.json({ error: "Invalid transition for payroll status." }, { status: 409 });
      await client.query("UPDATE payroll_runs SET status=$2 WHERE id=$1", [id, nextStatus]);
      return NextResponse.json({ id, status: nextStatus });
    });
  } catch (error) {
    console.error("Unable to update payroll run.", error);
    return NextResponse.json({ error: "Unable to update payroll run." }, { status: 500 });
  }
}
