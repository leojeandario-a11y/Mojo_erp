import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { FinanceDocumentError, isSafeFinanceDocumentKey, readFinanceDocument } from "@/lib/finance-documents";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid document." }, { status: 400 });

  const document = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
    const result = await client.query<{
      employee_id: string;
      storage_path: string;
      file_name: string;
      mime_type: string | null;
    }>(
      `SELECT ed.employee_id, d.storage_path, d.file_name, d.mime_type
       FROM employee_documents ed
       JOIN documents d ON d.id = ed.document_id
       WHERE d.id = $1 AND d.confidentiality = 'hr'
       AND (
         app_has_permission('hr.employee.read')
         OR EXISTS (SELECT 1 FROM employees e WHERE e.id = ed.employee_id AND e.user_id = app_user_id())
       )`,
      [id],
    );
    if (!result.rowCount) throw new FinanceDocumentError("Document not found.", 404);
    if (!isSafeFinanceDocumentKey(result.rows[0].storage_path)) {
      throw new FinanceDocumentError("Document not found.", 404);
    }
    return result.rows[0];
  });
  const bytes = await readFinanceDocument(document.storage_path);
  const filename = encodeURIComponent(document.file_name).replaceAll("'", "%27");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": document.mime_type ?? "application/octet-stream",
      "content-length": String(bytes.byteLength),
      "content-disposition": `attachment; filename*=UTF-8''${filename}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
