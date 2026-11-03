import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { hasAnyPermission, hasEntityPermission, hasPermission } from "@/lib/permissions";
import { reportDefinitions } from "@/lib/reports";
import { nextReportRun } from "@/lib/report-schedule.mjs";

const createSchema = z.object({
  category: z.enum(["finance", "hr", "business", "marketing", "operations", "store"]),
  frequency: z.enum(["daily", "weekly", "monthly"]),
  entityId: z.uuid().optional(),
  windowDays: z.union([z.literal(7), z.literal(30), z.literal(90), z.literal(365)]).default(30),
}).strict();

function needsReportScheduleMigration(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    && error.code === "42P01";
}

function migrationRequiredResponse() {
  return NextResponse.json(
    { error: "Report scheduling is unavailable until database migration 034 is applied by a database owner." },
    { status: 503 },
  );
}

export async function GET(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  try {
    const schedules = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const result = await client.query(
        `SELECT schedule.id, schedule.category, schedule.frequency, schedule.entity_id,
                entity.name AS entity_name, schedule.window_days,
                schedule.next_run_at, schedule.last_run_at
         FROM report_schedules schedule
         LEFT JOIN entities entity ON entity.id = schedule.entity_id
         WHERE schedule.owner_id = $1 AND schedule.is_active
         ORDER BY schedule.next_run_at, schedule.created_at`,
        [actor.id],
      );
      return result.rows;
    });
    return NextResponse.json({ schedules }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (needsReportScheduleMigration(error)) return migrationRequiredResponse();
    console.error("Unable to load report schedules.", error);
    return NextResponse.json({ error: "Unable to load report schedules." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid report schedule." }, { status: 400 });

  const definition = reportDefinitions[parsed.data.category];
  if (!hasAnyPermission(actor, [definition.permission])) {
    return NextResponse.json({ error: "Permission denied." }, { status: 403 });
  }
  if (parsed.data.entityId
    ? !hasEntityPermission(actor, definition.permission, parsed.data.entityId)
    : !hasPermission(actor, definition.permission)) {
    return NextResponse.json({ error: "Choose an entity you are allowed to report on." }, { status: 403 });
  }

  try {
    const schedule = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const permission = await client.query<{ allowed: boolean }>(
        `SELECT CASE WHEN $2::uuid IS NULL
          THEN app_has_permission($1)
          ELSE app_has_entity_permission($1, $2::uuid)
        END AS allowed`,
        [definition.permission, parsed.data.entityId ?? null],
      );
      if (!permission.rows[0]?.allowed) {
        return { denied: true as const };
      }

      const nextRunAt = nextReportRun(parsed.data.frequency);
      const result = await client.query(
        `INSERT INTO report_schedules(
           owner_id, category, frequency, entity_id, window_days, next_run_at
         )
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, category, frequency, entity_id, window_days, next_run_at`,
        [
          actor.id,
          parsed.data.category,
          parsed.data.frequency,
          parsed.data.entityId ?? null,
          parsed.data.windowDays,
          nextRunAt,
        ],
      );
      return { denied: false as const, schedule: result.rows[0] };
    });
    if (schedule.denied) return NextResponse.json({ error: "Permission denied." }, { status: 403 });
    return NextResponse.json({ schedule: schedule.schedule }, { status: 201 });
  } catch (error) {
    if (needsReportScheduleMigration(error)) return migrationRequiredResponse();
    console.error("Unable to create report schedule.", error);
    return NextResponse.json({ error: "Unable to create report schedule." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const id = z.uuid().safeParse(new URL(request.url).searchParams.get("id"));
  if (!id.success) return NextResponse.json({ error: "Invalid report schedule." }, { status: 400 });

  try {
    const deleted = await withDbUser(actor.id, requestIp(request.headers), async (client) =>
      client.query(
        "DELETE FROM report_schedules WHERE id = $1 AND owner_id = $2 RETURNING id",
        [id.data, actor.id],
      ),
    );
    if (!deleted.rowCount) return NextResponse.json({ error: "Report schedule not found." }, { status: 404 });
    return NextResponse.json({ deleted: true });
  } catch (error) {
    if (needsReportScheduleMigration(error)) return migrationRequiredResponse();
    console.error("Unable to delete report schedule.", error);
    return NextResponse.json({ error: "Unable to delete report schedule." }, { status: 500 });
  }
}
