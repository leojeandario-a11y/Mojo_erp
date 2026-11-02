import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid employee." }, { status: 400 });

  const history = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
    const result = await client.query(
      `SELECT id, change_type, from_value, to_value, effective_date::text, note
       FROM employment_history
       WHERE employee_id = $1
       ORDER BY effective_date DESC, id DESC`,
      [id],
    );
    return result.rows;
  });
  return NextResponse.json({ history });
}

