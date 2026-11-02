import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { hasEntityPermission } from "@/lib/permissions";
import { FinanceDocumentError, isUploadedFile, MAX_FINANCE_DOCUMENT_SIZE, removeFinanceDocument, storeFinanceDocument } from "@/lib/finance-documents";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid transaction." }, { status: 400 });

  try {
    const documents = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const transaction = await client.query<{ entity_id: string; created_by: string | null }>(
        "SELECT entity_id, created_by FROM transactions WHERE id = $1",
        [id],
      );
      if (!transaction.rowCount) throw new FinanceDocumentError("Transaction not found.", 404);
      const row = transaction.rows[0];
      const canRead = hasEntityPermission(actor, "finance.transaction.read", row.entity_id);
      const ownsDraft = row.created_by === actor.id
        && hasEntityPermission(actor, "finance.transaction.create", row.entity_id);
      if (!canRead && !ownsDraft) throw new FinanceDocumentError("Permission denied for this entity.", 403);

      const result = await client.query(
        `SELECT id, title, file_name, mime_type, size_bytes::text, created_at
         FROM documents
         WHERE owner_table = 'transactions' AND owner_id = $1 AND confidentiality = 'finance'
         ORDER BY created_at, id`,
        [id],
      );
      return result.rows.map((document) => ({
        id: document.id,
        title: document.title,
        fileName: document.file_name,
        mimeType: document.mime_type,
        sizeBytes: document.size_bytes,
        createdAt: document.created_at,
        downloadUrl: `/api/v1/finance/documents/${document.id}`,
      }));
    });
    return NextResponse.json({ documents });
  } catch (error) {
    if (error instanceof FinanceDocumentError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Unable to list finance documents.", error);
    return NextResponse.json({ error: "Unable to list finance documents." }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid transaction." }, { status: 400 });

  let storageKey: string | null = null;
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!isUploadedFile(file)) throw new FinanceDocumentError("A supporting document file is required.", 400);
    if (file.size > MAX_FINANCE_DOCUMENT_SIZE) throw new FinanceDocumentError("Supporting documents cannot exceed 10 MB.", 413);

    const document = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const result = await client.query<{ entity_id: string; created_by: string | null; status: string }>(
        "SELECT entity_id, created_by, status FROM transactions WHERE id = $1 FOR UPDATE",
        [id],
      );
      if (!result.rowCount) throw new FinanceDocumentError("Transaction not found.", 404);
      const transaction = result.rows[0];
      if (transaction.created_by !== actor.id || transaction.status !== "draft") {
        throw new FinanceDocumentError("Only the creator can attach documents to a draft transaction.", 409);
      }
      if (!hasEntityPermission(actor, "finance.transaction.create", transaction.entity_id)) {
        throw new FinanceDocumentError("Permission denied for this entity.", 403);
      }
      const allowed = await client.query<{ allowed: boolean }>(
        "SELECT app_has_entity_permission('finance.transaction.create', $1::uuid) AS allowed",
        [transaction.entity_id],
      );
      if (!allowed.rows[0]?.allowed) throw new FinanceDocumentError("Permission denied for this entity.", 403);

      const stored = await storeFinanceDocument(file);
      storageKey = stored.storageKey;
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO documents(owner_table, owner_id, title, file_name, storage_path, mime_type, size_bytes, sha256, confidentiality, uploaded_by)
         VALUES ('transactions', $1, $2, $2, $3, $4, $5, $6, 'finance', $7)
         RETURNING id`,
        [id, stored.fileName, stored.storageKey, stored.mimeType, stored.sizeBytes, stored.sha256, actor.id],
      );
      return { id: inserted.rows[0].id, fileName: stored.fileName, sizeBytes: stored.sizeBytes };
    });
    return NextResponse.json({ document }, { status: 201 });
  } catch (error) {
    if (storageKey) await removeFinanceDocument(storageKey).catch(() => undefined);
    if (error instanceof FinanceDocumentError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Unable to attach finance document.", error);
    return NextResponse.json({ error: "Unable to attach finance document." }, { status: 500 });
  }
}
