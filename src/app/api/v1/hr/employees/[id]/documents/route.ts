import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import {
  FinanceDocumentError,
  isUploadedFile,
  MAX_FINANCE_DOCUMENT_SIZE,
  removeFinanceDocument,
  storeFinanceDocument,
} from "@/lib/finance-documents";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid employee." }, { status: 400 });

  const documents = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
    const result = await client.query(
      `SELECT d.id, d.title, d.file_name, d.mime_type, d.size_bytes::text, ed.document_kind, ed.created_at
       FROM employee_documents ed
       JOIN documents d ON d.id = ed.document_id
       WHERE ed.employee_id = $1 AND d.confidentiality = 'hr'
       ORDER BY ed.created_at DESC`,
      [id],
    );
    return result.rows;
  });
  return NextResponse.json({ documents });
}

export async function POST(request: Request, { params }: RouteContext) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid employee." }, { status: 400 });

  let storageKey: string | null = null;
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const kind = String(formData.get("documentKind") ?? "").trim();
    if (!isUploadedFile(file)) throw new FinanceDocumentError("A document file is required.", 400);
    if (!kind) throw new FinanceDocumentError("A document kind is required.", 400);
    if (file.size > MAX_FINANCE_DOCUMENT_SIZE) throw new FinanceDocumentError("Documents cannot exceed 10 MB.", 413);

    const document = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const permission = await client.query<{ allowed: boolean }>(
        "SELECT app_has_permission('hr.employee.manage') AS allowed",
      );
      if (!permission.rows[0]?.allowed) throw new FinanceDocumentError("Permission denied.", 403);
      const employee = await client.query("SELECT id FROM employees WHERE id = $1", [id]);
      if (!employee.rowCount) throw new FinanceDocumentError("Employee not found.", 404);
      const stored = await storeFinanceDocument(file);
      storageKey = stored.storageKey;
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO documents(owner_table, owner_id, title, file_name, storage_path, mime_type, size_bytes, sha256, confidentiality, uploaded_by)
         VALUES ('employees', $1, $2, $2, $3, $4, $5, $6, 'hr', $7)
         RETURNING id`,
        [id, stored.fileName, stored.storageKey, stored.mimeType, stored.sizeBytes, stored.sha256, actor.id],
      );
      await client.query(
        "INSERT INTO employee_documents(employee_id, document_id, document_kind) VALUES ($1, $2, $3)",
        [id, inserted.rows[0].id, kind],
      );
      return { id: inserted.rows[0].id, fileName: stored.fileName, kind };
    });
    return NextResponse.json({ document }, { status: 201 });
  } catch (error) {
    if (storageKey) await removeFinanceDocument(storageKey).catch(() => undefined);
    if (error instanceof FinanceDocumentError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Unable to attach HR document.", error);
    return NextResponse.json({ error: "Unable to attach HR document." }, { status: 500 });
  }
}
