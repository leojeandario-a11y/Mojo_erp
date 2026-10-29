import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession, hasPermission } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { csvCell } from "@/lib/csv.mjs";

const querySchema = z.object({
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }).optional(),
  userId: z.uuid().optional(),
  module: z.string().max(120).optional(),
  action: z.string().max(120).optional(),
  result: z.enum(["success", "denied"]).optional(),
  format: z.enum(["csv"]).optional(),
  facets: z.enum(["1"]).optional(),
});

export async function GET(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!hasPermission(actor, "audit.read")) {
    return NextResponse.json({ error: "Permission denied." }, { status: 403 });
  }
  const params = new URL(request.url).searchParams;
  const parsed = querySchema.safeParse(Object.fromEntries(params));
  if (!parsed.success) return NextResponse.json({ error: "Invalid audit query." }, { status: 400 });

  if (parsed.data.from && parsed.data.to && parsed.data.from > parsed.data.to) {
    return NextResponse.json({ error: "The start date must not be after the end date." }, { status: 400 });
  }
  if (parsed.data.facets) {
    const facets = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const [users, modules, actions] = await Promise.all([
        client.query("SELECT DISTINCT a.user_id AS id, u.full_name AS name FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id WHERE a.user_id IS NOT NULL ORDER BY name LIMIT 500"),
        client.query("SELECT DISTINCT module FROM audit_logs WHERE module IS NOT NULL ORDER BY module LIMIT 100"),
        client.query("SELECT DISTINCT action FROM audit_logs ORDER BY action LIMIT 100"),
      ]);
      return { users: users.rows, modules: modules.rows.map((row) => row.module), actions: actions.rows.map((row) => row.action) };
    });
    return NextResponse.json({ facets });
  }

  const result = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
    const conditions: string[] = [];
    const values: (string | number)[] = [];
    const addFilter = (condition: string, value: string) => {
      values.push(value);
      conditions.push(condition.replace("?", `$${values.length}`));
    };
    if (parsed.data.from) addFilter("a.occurred_at >= ?::date", parsed.data.from);
    if (parsed.data.to) addFilter("a.occurred_at < ?::date + interval '1 day'", parsed.data.to);
    if (parsed.data.userId) addFilter("a.user_id = ?::uuid", parsed.data.userId);
    if (parsed.data.module) addFilter("a.module = ?", parsed.data.module);
    if (parsed.data.action) addFilter("a.action = ?", parsed.data.action);
    if (parsed.data.result) addFilter("a.result = ?", parsed.data.result);
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    if (parsed.data.format === "csv") {
      const exportResult = await client.query(
        `SELECT a.occurred_at, u.full_name AS actor_name, a.user_id, a.module, a.action,
                a.table_name, a.record_id, a.result, a.message
         FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
         ${where}
         ORDER BY a.occurred_at DESC, a.id DESC
         LIMIT 10001`,
        values,
      );
      const rows = exportResult.rows.slice(0, 10_000);
      const content = [
        ["occurred_at", "actor", "user_id", "module", "action", "table", "record_id", "result", "message"].map(csvCell).join(","),
        ...rows.map((row) => [
          row.occurred_at instanceof Date ? row.occurred_at.toISOString() : row.occurred_at,
          row.actor_name, row.user_id, row.module, row.action, row.table_name, row.record_id, row.result, row.message,
        ].map(csvCell).join(",")),
      ].join("\r\n");
      return {
        kind: "csv" as const,
        response: new Response(content, {
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": `attachment; filename="${exportResult.rows.length > 10_000 ? "mojo-audit-truncated.csv" : "mojo-audit.csv"}"`,
            "x-export-truncated": String(exportResult.rows.length > 10_000),
          },
        }),
      };
    }
    values.push(parsed.data.offset);
    const page = await client.query(
      `SELECT a.id, a.occurred_at, a.user_id, u.full_name AS actor_name, a.module, a.action,
              a.table_name, a.record_id, a.result, a.message
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       ${where}
       ORDER BY a.occurred_at DESC, a.id DESC
       LIMIT 51 OFFSET $${values.length}`,
      values,
    );
    return { kind: "page" as const, page };
  });
  if (result.kind === "csv") return result.response;
  const hasMore = result.page.rows.length > 50;
  return NextResponse.json({
    events: result.page.rows.slice(0, 50),
    hasMore,
    offset: parsed.data.offset,
  });
}
