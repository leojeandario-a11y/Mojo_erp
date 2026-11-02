import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { FinanceDocumentError, isSafeFinanceDocumentKey, readFinanceDocument } from "@/lib/finance-documents";
import { hasEntityPermission } from "@/lib/permissions";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid document." }, { status: 400 });

  try {
    const document = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const result = await client.query<{
        owner_id: string;
        owner_table: string;
        storage_path: string;
        file_name: string;
        mime_type: string | null;
        entity_id: string;
        created_by: string | null;
      }>(
        `SELECT d.owner_id, d.owner_table, d.storage_path, d.file_name, d.mime_type,
                COALESCE(t.entity_id, fund.entity_id) AS entity_id,
                COALESCE(t.created_by, withdrawal.requested_by) AS created_by
         FROM documents d
         LEFT JOIN transactions t ON d.owner_table = 'transactions' AND t.id = d.owner_id
         LEFT JOIN fund_withdrawals withdrawal
           ON d.owner_table = 'fund_withdrawals' AND withdrawal.id = d.owner_id
         LEFT JOIN emergency_funds fund ON fund.id = withdrawal.fund_id
         WHERE d.id = $1 AND d.confidentiality = 'finance'
           AND (
             (d.owner_table = 'transactions' AND t.id IS NOT NULL)
             OR (d.owner_table = 'fund_withdrawals' AND withdrawal.id IS NOT NULL)
           )`,
        [id],
      );
      if (!result.rowCount) throw new FinanceDocumentError("Document not found.", 404);
      const row = result.rows[0];
      if (!isSafeFinanceDocumentKey(row.storage_path)) {
        throw new FinanceDocumentError("Document not found.", 404);
      }
      if (row.owner_table === "transactions") {
        const canRead = hasEntityPermission(actor, "finance.transaction.read", row.entity_id);
        const ownsDraft = row.created_by === actor.id
          && hasEntityPermission(actor, "finance.transaction.create", row.entity_id);
        if (!canRead && !ownsDraft) throw new FinanceDocumentError("Permission denied for this document.", 403);
      } else {
        const canRead = hasEntityPermission(actor, "finance.fund.read", row.entity_id)
          || hasEntityPermission(actor, "finance.fund.approve_withdrawal", row.entity_id);
        const ownsRequest = row.created_by === actor.id
          && hasEntityPermission(actor, "finance.fund.request_withdrawal", row.entity_id);
        if (!canRead && !ownsRequest) throw new FinanceDocumentError("Permission denied for this document.", 403);
      }
      return row;
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
  } catch (error) {
    if (error instanceof FinanceDocumentError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Unable to download finance document.", error);
    return NextResponse.json({ error: "Unable to download finance document." }, { status: 500 });
  }
}
