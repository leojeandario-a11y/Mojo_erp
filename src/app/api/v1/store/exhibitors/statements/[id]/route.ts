import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { getStoreEntity, requireStorePermission, StorePolicyError } from "@/lib/store";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid statement id." }, { status: 400 });
  try {
    return await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const store = await getStoreEntity(client);
      await requireStorePermission(client, actor, "store.report.read", store.id);
      const statement = await client.query(
        `SELECT s.*,e.name AS exhibitor
         FROM exhibitor_statements s JOIN exhibitors e ON e.id=s.exhibitor_id
         WHERE s.id=$1`,
        [id],
      );
      if (!statement.rowCount) throw new StorePolicyError("Statement not found.", 404);
      const lines = await client.query(
        `SELECT l.sale_id,s.receipt_number,s.sold_at::date::text AS sold_on,
                l.sales_amount_usd::text,l.commission_usd::text
         FROM exhibitor_statement_lines l JOIN sales s ON s.id=l.sale_id
         WHERE l.statement_id=$1 ORDER BY s.sold_at,s.receipt_number`,
        [id],
      );
      return NextResponse.json({ statement: statement.rows[0], lines: lines.rows });
    });
  } catch (error) {
    if (error instanceof StorePolicyError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Unable to load exhibitor statement.", error);
    return NextResponse.json({ error: "Unable to load exhibitor statement." }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid statement id." }, { status: 400 });
  const parsed = z.object({ action: z.literal("validate") }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid statement action." }, { status: 400 });
  try {
    const statement = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const store = await getStoreEntity(client);
      await requireStorePermission(client, actor, "store.exhibitor.validate", store.id);
      const result = await client.query<{ status: string }>(
        "SELECT s.status FROM exhibitor_statements s JOIN exhibitors e ON e.id=s.exhibitor_id WHERE s.id=$1 FOR UPDATE OF s",
        [id],
      );
      if (!result.rowCount) throw new StorePolicyError("Statement not found.", 404);
      if (result.rows[0].status !== "open") throw new StorePolicyError("Only open statements can be validated.", 409);
      const validated = await client.query(
        `UPDATE exhibitor_statements SET status='validated',validated_by=$2,validated_at=now()
         WHERE id=$1 AND status='open' RETURNING id,status,validated_by,validated_at`,
        [id, actor.id],
      );
      return validated.rows[0];
    });
    return NextResponse.json({ statement });
  } catch (error) {
    if (error instanceof StorePolicyError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Unable to validate exhibitor statement.", error);
    return NextResponse.json({ error: "Unable to validate exhibitor statement." }, { status: 500 });
  }
}
