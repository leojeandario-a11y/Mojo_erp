import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { hasEntityPermission } from "@/lib/permissions";
import {
  EmergencyFundError,
  convertFundCurrency,
  getEmergencyFund,
  getFundApprovalWorkflow,
  historicalRateToUsd,
  notifyFundApprovers,
  requireFundPermission,
} from "@/lib/emergency-fund";
import {
  FinanceDocumentError,
  isUploadedFile,
  removeFinanceDocument,
  storeFinanceDocument,
} from "@/lib/finance-documents";
import { schedulePushDeliveryAfterResponse } from "@/lib/web-push";

const withdrawalSchema = z.object({
  amount: z.string().regex(/^\d{1,16}(?:\.\d{1,2})?$/).refine((value) => Number(value) > 0),
  currency: z.enum(["HTG", "USD"]),
  reason: z.string().trim().min(3).max(500),
  date: z.iso.date(),
});

export async function GET(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  try {
    const data = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const fund = await getEmergencyFund(client);
      if (!hasEntityPermission(actor, "finance.fund.read", fund.entity_id)
          && !hasEntityPermission(actor, "finance.fund.request_withdrawal", fund.entity_id)
          && !hasEntityPermission(actor, "finance.fund.approve_withdrawal", fund.entity_id)) {
        throw new EmergencyFundError("Permission denied for fund withdrawals.", 403);
      }
      const permission = hasEntityPermission(actor, "finance.fund.read", fund.entity_id)
        ? "finance.fund.read"
        : hasEntityPermission(actor, "finance.fund.request_withdrawal", fund.entity_id)
          ? "finance.fund.request_withdrawal"
          : "finance.fund.approve_withdrawal";
      await requireFundPermission(client, permission, fund.entity_id);
      const withdrawals = await client.query(
        `SELECT withdrawal.id, withdrawal.requested_by, requester.full_name AS requester_name,
                withdrawal.amount::text, withdrawal.currency,
                withdrawal.requested_amount::text, withdrawal.requested_currency,
                withdrawal.reason, withdrawal.status, withdrawal.requested_at::text,
                withdrawal.requested_date::text,
                withdrawal.decided_at::text, withdrawal.disbursed_at::text,
                withdrawal.transaction_id, tx.tx_number AS transaction_number,
                approval.id AS approval_request_id, approval.current_step,
                approval.status AS approval_status,
                COALESCE(attachments.documents, '[]'::json) AS documents
         FROM fund_withdrawals withdrawal
         JOIN users requester ON requester.id = withdrawal.requested_by
         LEFT JOIN transactions tx ON tx.id = withdrawal.transaction_id
         LEFT JOIN approval_requests approval ON approval.id = withdrawal.approval_request_id
         LEFT JOIN LATERAL (
           SELECT json_agg(json_build_object(
                    'id', document.id, 'fileName', document.file_name,
                    'downloadUrl', '/api/v1/finance/documents/' || document.id::text,
                    'createdAt', document.created_at::text
                  ) ORDER BY document.created_at, document.id) AS documents
           FROM documents document
           WHERE document.owner_table = 'fund_withdrawals' AND document.owner_id = withdrawal.id
             AND document.confidentiality = 'finance'
         ) attachments ON true
         WHERE withdrawal.fund_id = $1
           AND ($2::boolean OR withdrawal.requested_by = $3
             OR approval.id IN (
               SELECT action.request_id FROM approval_actions action WHERE action.actor_id = $3
             ))
         ORDER BY withdrawal.requested_at DESC, withdrawal.id DESC
         LIMIT 500`,
        [
          fund.id,
          hasEntityPermission(actor, "finance.fund.read", fund.entity_id)
            || hasEntityPermission(actor, "finance.fund.approve_withdrawal", fund.entity_id),
          actor.id,
        ],
      );
      return {
        withdrawals: withdrawals.rows,
        currency: fund.currency,
        canRequestWithdrawal: hasEntityPermission(actor, "finance.fund.request_withdrawal", fund.entity_id)
          && await client.query<{ allowed: boolean }>(
            "SELECT app_has_entity_permission('finance.fund.request_withdrawal', $1::uuid) AS allowed",
            [fund.entity_id],
          ).then((permissionResult) => permissionResult.rows[0]?.allowed === true),
        canDisburse: hasEntityPermission(actor, "finance.fund.approve_withdrawal", fund.entity_id)
          && hasEntityPermission(actor, "finance.transaction.validate", fund.entity_id)
          && await client.query<{ allowed: boolean }>(
            `SELECT app_has_entity_permission('finance.fund.approve_withdrawal', $1::uuid)
                    AND app_has_entity_permission('finance.transaction.validate', $1::uuid) AS allowed`,
            [fund.entity_id],
          ).then((permissionResult) => permissionResult.rows[0]?.allowed === true),
      };
    });
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof EmergencyFundError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Unable to load emergency fund withdrawals.", error);
    return NextResponse.json({ error: "Unable to load emergency fund withdrawals." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const storedKeys: string[] = [];

  try {
    const formData = await request.formData();
    const parsed = withdrawalSchema.safeParse({
      amount: formData.get("amount"),
      currency: formData.get("currency"),
      reason: formData.get("reason"),
      date: formData.get("date"),
    });
    if (!parsed.success) throw new FinanceDocumentError("Invalid withdrawal request details.", 400);
    const submittedFiles = formData.getAll("documents");
    if (submittedFiles.some((file) => !isUploadedFile(file))) {
      throw new FinanceDocumentError("Invalid supporting document.", 400);
    }
    const files = submittedFiles.filter(isUploadedFile);
    if (!files.length) throw new FinanceDocumentError("Attach at least one supporting document.", 400);
    if (files.length > 5) throw new FinanceDocumentError("At most five supporting documents may be attached.", 400);

    const withdrawal = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const fund = await getEmergencyFund(client, true);
      if (!hasEntityPermission(actor, "finance.fund.request_withdrawal", fund.entity_id)) {
        throw new EmergencyFundError("Permission denied to request a fund withdrawal.", 403);
      }
      await requireFundPermission(client, "finance.fund.request_withdrawal", fund.entity_id);
      if (!fund.account_id) throw new EmergencyFundError("Configure the fund account first.", 409);

      const amount = await convertFundCurrency(
        client,
        parsed.data.amount,
        parsed.data.currency,
        fund.currency,
        parsed.data.date,
      );
      if (amount === "0.00") throw new EmergencyFundError("The withdrawal rounds to zero in the fund currency.", 400);
      const fxRate = await historicalRateToUsd(client, fund.currency, parsed.data.date);
      const amountUsd = (await client.query<{ value: string }>(
        "SELECT round($1::numeric * $2::numeric, 2)::text AS value",
        [amount, fxRate],
      )).rows[0].value;
      const approval = await getFundApprovalWorkflow(
        client,
        "fund_withdrawal",
        fund.entity_id,
        actor.id,
        amountUsd,
      );
      const balanceResult = await client.query<{ balance: string; reserved: string }>(
        `SELECT fund_balance.balance::text,
                COALESCE((
                  SELECT SUM(other.amount)
                  FROM fund_withdrawals other
                  WHERE other.fund_id = fund.id AND other.status = 'approved'
                ), 0)::text AS reserved
         FROM v_fund_balance fund_balance
         JOIN emergency_funds fund ON fund.id = fund_balance.fund_id
         WHERE fund.id = $1`,
        [fund.id],
      );
      const available = await client.query<{ enough: boolean }>(
        "SELECT $1::numeric - $2::numeric >= $3::numeric AS enough",
        [balanceResult.rows[0].balance, balanceResult.rows[0].reserved, amount],
      );
      if (!available.rows[0].enough) {
        throw new EmergencyFundError("The requested amount exceeds the available fund balance.", 409);
      }

      const created = await client.query<{ id: string }>(
        `INSERT INTO fund_withdrawals(
           fund_id, requested_by, amount, currency, requested_amount, requested_currency,
           reason, status, requested_date
         )
         VALUES ($1, $2, $3::numeric, $4, $5::numeric, $6, $7, 'pending', $8::date)
         RETURNING id`,
        [
          fund.id,
          actor.id,
          amount,
          fund.currency,
          parsed.data.amount,
          parsed.data.currency,
          parsed.data.reason,
          parsed.data.date,
        ],
      );
      const id = created.rows[0].id;
      for (const file of files) {
        const document = await storeFinanceDocument(file);
        storedKeys.push(document.storageKey);
        await client.query(
          `INSERT INTO documents(
             owner_table, owner_id, title, file_name, storage_path, mime_type,
             size_bytes, sha256, confidentiality, uploaded_by
           )
           VALUES ('fund_withdrawals', $1, $2, $2, $3, $4, $5, $6, 'finance', $7)`,
          [id, document.fileName, document.storageKey, document.mimeType, document.sizeBytes, document.sha256, actor.id],
        );
      }

      const approvalResult = await client.query<{ id: string }>(
        `INSERT INTO approval_requests(
           workflow_id, request_type, ref_table, ref_id, requester_id, title,
           amount, currency, amount_usd, current_step
         )
         VALUES ($1, 'fund_withdrawal', 'fund_withdrawals', $2, $3, $4,
                 $5::numeric, $6, $7::numeric, $8)
         RETURNING id`,
        [
          approval.workflowId,
          id,
          actor.id,
          `Retrait du fonds · ${parsed.data.reason}`,
          amount,
          fund.currency,
          amountUsd,
          approval.step.step_order,
        ],
      );
      const approvalRequestId = approvalResult.rows[0].id;
      await client.query(
        "UPDATE fund_withdrawals SET approval_request_id = $2 WHERE id = $1",
        [id, approvalRequestId],
      );
      await notifyFundApprovers(
        client,
        approval.approverIds,
        { fr: "Retrait du fonds à approuver", ht: "Retrè fon an pou apwouve", en: "Fund withdrawal approval required" },
        {
          fr: `Une demande de retrait de ${amount} ${fund.currency} attend votre décision.`,
          ht: `Yon demann retrè ${amount} ${fund.currency} ap tann desizyon ou.`,
          en: `A withdrawal request for ${amount} ${fund.currency} is awaiting your decision.`,
        },
        approvalRequestId,
      );
      return { id, approvalRequestId, amount, currency: fund.currency };
    });
    schedulePushDeliveryAfterResponse();
    return NextResponse.json({ withdrawal }, { status: 201 });
  } catch (error) {
    for (const key of storedKeys) {
      try {
        await removeFinanceDocument(key);
      } catch (cleanupError) {
        console.error("Unable to clean up an unlinked fund withdrawal document.", cleanupError);
      }
    }
    if (error instanceof EmergencyFundError || error instanceof FinanceDocumentError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Unable to submit emergency fund withdrawal.", error);
    return NextResponse.json({ error: "Unable to submit emergency fund withdrawal." }, { status: 500 });
  }
}
