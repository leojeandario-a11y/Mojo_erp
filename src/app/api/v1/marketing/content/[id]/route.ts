import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { isSuperAdmin } from "@/lib/permissions";

const contentSchema = z.object({
  campaignId: z.union([z.uuid(), z.literal(""), z.null()]).optional(),
  title: z.string().trim().min(1).max(240),
  contentType: z.enum(["post", "visual", "video", "article", "ad", "other"]),
  channel: z.string().trim().max(120).nullable().optional(),
  scheduledAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/).nullable().optional(),
  ownerId: z.union([z.uuid(), z.literal(""), z.null()]).optional(),
  status: z.enum(["idea", "in_production", "scheduled", "published", "cancelled"]),
  body: z.string().nullable().optional(),
}).strict();

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!isSuperAdmin(actor)) return NextResponse.json({ error: "Super-administrator access required." }, { status: 403 });

  const { id } = await context.params;
  const parsed = contentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid content details." }, { status: 400 });

  try {
    return await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const audit = await client.query<{ ready: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM pg_trigger
           WHERE tgrelid = 'content_items'::regclass
             AND tgname = 'trg_content_items_audit'
             AND tgenabled IN ('O', 'A')
             AND NOT tgisinternal
         ) AS ready`,
      );
      if (!audit.rows[0]?.ready) {
        return NextResponse.json({ error: "Apply migration 036 before editing marketing content." }, { status: 503 });
      }

      const current = await client.query<{ status: string; published_at: string | null }>(
        "SELECT status, published_at FROM content_items WHERE id = $1 FOR UPDATE",
        [id],
      );
      const item = current.rows[0];
      if (!item) return NextResponse.json({ error: "Content item not found." }, { status: 404 });
      if (item.status === "published" || item.published_at) {
        return NextResponse.json({ error: "Published content cannot be edited." }, { status: 409 });
      }

      const data = parsed.data;
      const result = await client.query(
        `UPDATE content_items
         SET campaign_id = NULLIF($2, '')::uuid, title = $3, content_type = $4,
             channel = $5, scheduled_at = NULLIF($6, '')::timestamptz,
             owner_id = NULLIF($7, '')::uuid, status = $8, body = $9
         WHERE id = $1
         RETURNING id, title, status`,
        [
          id, data.campaignId ?? "", data.title, data.contentType, data.channel ?? null,
          data.scheduledAt ?? "", data.ownerId ?? "", data.status, data.body ?? null,
        ],
      );
      return NextResponse.json(result.rows[0]);
    });
  } catch (error) {
    console.error("Unable to update marketing content.", error);
    return NextResponse.json({ error: "Unable to update marketing content." }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!isSuperAdmin(actor)) return NextResponse.json({ error: "Super-administrator access required." }, { status: 403 });

  const { id } = await context.params;
  try {
    return await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const audit = await client.query<{ ready: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM pg_trigger
           WHERE tgrelid = 'content_items'::regclass
             AND tgname = 'trg_content_items_audit'
             AND tgenabled IN ('O', 'A')
             AND NOT tgisinternal
         ) AS ready`,
      );
      if (!audit.rows[0]?.ready) {
        return NextResponse.json({ error: "Apply migration 036 before removing marketing content." }, { status: 503 });
      }

      const current = await client.query<{ status: string; published_at: string | null }>(
        "SELECT status, published_at FROM content_items WHERE id = $1 FOR UPDATE",
        [id],
      );
      const item = current.rows[0];
      if (!item) return NextResponse.json({ error: "Content item not found." }, { status: 404 });
      if (item.status === "published" || item.published_at) {
        return NextResponse.json({ error: "Published content must remain in the content history." }, { status: 409 });
      }
      await client.query("DELETE FROM content_items WHERE id = $1", [id]);
      return NextResponse.json({ deleted: true });
    });
  } catch (error) {
    console.error("Unable to remove marketing content.", error);
    return NextResponse.json({ error: "Unable to remove marketing content." }, { status: 500 });
  }
}
