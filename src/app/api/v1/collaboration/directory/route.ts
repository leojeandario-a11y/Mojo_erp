import { NextResponse } from "next/server";
import { getSession, hasPermission } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";

export async function GET(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (
    !hasPermission(actor, "collaboration.announcement.global")
    && !hasPermission(actor, "collaboration.announcement.department")
  ) {
    return NextResponse.json({ error: "You are not allowed to view the user directory." }, { status: 403 });
  }

  try {
    const users = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const result = await client.query(
        `SELECT user_record.id, user_record.full_name,
                department.name AS department_name
         FROM users user_record
         LEFT JOIN departments department ON department.id = user_record.department_id
         WHERE user_record.is_active
         ORDER BY user_record.full_name
         LIMIT 500`,
      );
      return result.rows;
    });
    return NextResponse.json({ users });
  } catch (error) {
    console.error("Unable to load collaboration directory.", error);
    return NextResponse.json({ error: "Unable to load the user directory." }, { status: 500 });
  }
}
