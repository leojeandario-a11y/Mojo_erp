import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export async function GET() {
  const result = await getPool().query(
    "SELECT id, name FROM departments WHERE is_active ORDER BY name",
  );
  return NextResponse.json({ departments: result.rows });
}
