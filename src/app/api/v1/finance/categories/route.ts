import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { hasAnyPermission, hasEntityPermission } from "@/lib/permissions";
import { requestIp, withDbUser } from "@/lib/db";

const categorySchema = z.object({
  entityId: z.uuid(),
  code: z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().trim().min(2).max(120),
  kind: z.enum(["income", "expense"]),
}).strict();

class CategoryPolicyError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function GET(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!hasAnyPermission(actor, [
    "finance.transaction.read",
    "finance.transaction.create",
    "finance.account.manage",
  ])) {
    return NextResponse.json({ error: "Permission denied." }, { status: 403 });
  }
  try {
    const result = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const categories = await client.query(
        `SELECT id, entity_id, code, name, kind, is_active
         FROM transaction_categories
         WHERE is_active
         ORDER BY kind, name`,
      );
      return categories.rows.filter((category) => category.entity_id === null
        || hasEntityPermission(actor, "finance.transaction.read", category.entity_id)
        || hasEntityPermission(actor, "finance.transaction.create", category.entity_id)
        || hasEntityPermission(actor, "finance.account.manage", category.entity_id));
    });
    return NextResponse.json({ categories: result });
  } catch (error) {
    console.error("Unable to load finance categories.", error);
    return NextResponse.json({ error: "Unable to load finance categories." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const parsed = categorySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid finance category." }, { status: 400 });
  if (!hasEntityPermission(actor, "finance.account.manage", parsed.data.entityId)) {
    return NextResponse.json({ error: "Permission denied for this entity." }, { status: 403 });
  }
  try {
    const id = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const permission = await client.query<{ allowed: boolean }>(
        "SELECT app_has_entity_permission('finance.account.manage', $1::uuid) AS allowed",
        [parsed.data.entityId],
      );
      if (!permission.rows[0]?.allowed) {
        throw new CategoryPolicyError("Permission denied for this entity.", 403);
      }
      const result = await client.query<{ id: string }>(
        `INSERT INTO transaction_categories(entity_id, code, name, kind)
         VALUES ($1, upper($2), $3, $4)
         RETURNING id`,
        [parsed.data.entityId, parsed.data.code, parsed.data.name, parsed.data.kind],
      );
      return result.rows[0].id;
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    if (error instanceof CategoryPolicyError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      return NextResponse.json({ error: "A category with this code already exists for the entity." }, { status: 409 });
    }
    console.error("Unable to create finance category.", error);
    return NextResponse.json({ error: "Unable to create finance category." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const parsed = z.object({
    id: z.uuid(),
    name: z.string().trim().min(2).max(120),
    isActive: z.boolean(),
  }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid finance category." }, { status: 400 });
  try {
    await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const current = await client.query<{ entity_id: string | null }>(
        "SELECT entity_id FROM transaction_categories WHERE id = $1 FOR UPDATE",
        [parsed.data.id],
      );
      if (!current.rowCount) throw new CategoryPolicyError("Category not found.", 404);
      const entityId = current.rows[0].entity_id;
      if (!entityId || !hasEntityPermission(actor, "finance.account.manage", entityId)) {
        throw new CategoryPolicyError("Permission denied for this entity.", 403);
      }
      const permission = await client.query<{ allowed: boolean }>(
        "SELECT app_has_entity_permission('finance.account.manage', $1::uuid) AS allowed",
        [entityId],
      );
      if (!permission.rows[0]?.allowed) {
        throw new CategoryPolicyError("Permission denied for this entity.", 403);
      }
      await client.query(
        "UPDATE transaction_categories SET name = $2, is_active = $3 WHERE id = $1",
        [parsed.data.id, parsed.data.name, parsed.data.isActive],
      );
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof CategoryPolicyError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Unable to update finance category.", error);
    return NextResponse.json({ error: "Unable to update finance category." }, { status: 500 });
  }
}
