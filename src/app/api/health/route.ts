import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export async function GET() {
  try {
    await getPool().query("SELECT 1");
    return NextResponse.json({ status: "ok" });
  } catch (error) {
    console.error("Health check failed.", error);
    return NextResponse.json({ status: "unavailable" }, { status: 503 });
  }
}
