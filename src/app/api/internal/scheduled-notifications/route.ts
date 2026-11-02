import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runScheduledNotifications } from "@/lib/scheduled-notifications";

export async function POST(request: Request) {
  const expectedToken = process.env.MOJO_SCHEDULED_TASK_TOKEN;
  if (!expectedToken || expectedToken.length < 32) {
    return NextResponse.json({ error: "Scheduled notifications are not configured." }, { status: 503 });
  }
  const authorization = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${expectedToken}`);
  const provided = Buffer.from(authorization);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  try {
    return NextResponse.json(await runScheduledNotifications());
  } catch (error) {
    console.error("Unable to run scheduled notifications.", error);
    return NextResponse.json({ error: "Unable to run scheduled notifications." }, { status: 500 });
  }
}
