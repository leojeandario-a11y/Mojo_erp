import { NextResponse } from "next/server";
import { z } from "zod";
import type { PoolClient } from "pg";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { hasAnyPermission, hasEntityPermission } from "@/lib/permissions";
import { csvCell } from "@/lib/csv.mjs";
import { exchangeRateToUsd } from "@/lib/finance-exchange-rates";

const createTransactionSchema = z.object({
  entityId: z.uuid(),
  accountId: z.uuid(),
  type: z.enum(["income", "expense", "adjustment"]),
  adjustmentDirection: z.enum(["increase", "decrease"]).nullable().optional(),
  date: z.iso.date(),
  amount: z.string().regex(/^\d{1,16}(?:\.\d{1,2})?$/).refine((value) => Number(value) > 0),
  categoryId: z.uuid().nullable(),
  description: z.string().trim().max(1000).nullable(),
}).strict().refine((data) =>
  data.type === "adjustment"
    ? data.adjustmentDirection === "increase" || data.adjustmentDirection === "decrease"
    : data.adjustmentDirection == null,
);

const transactionFiltersSchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  type: z.enum(["income", "expense", "transfer_in", "transfer_out", "adjustment"]).optional(),
  status: z.enum(["draft", "pending_approval", "validated", "rejected", "reversed"]).optional(),
  search: z.string().trim().max(120).optional(),
  format: z.enum(["csv"]).optional(),
}).strict().refine((filters) => !filters.from || !filters.to || filters.from <= filters.to);

class TransactionPolicyError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function hasEntityPermissionInDatabase(client: PoolClient, permission: string, entityId: string) {
  const result = await client.query<{ allowed: boolean }>(
    "SELECT app_has_entity_permission($1, $2::uuid) AS allowed",
    [permission, entityId],
  );
  return result.rows[0]?.allowed === true;
}

async function nextTransactionNumber(client: PoolClient, entityId: string, entityCode: string, year: number) {
  const result = await client.query<{ last_value: string }>(
    `INSERT INTO transaction_number_counters(entity_id, calendar_year, last_value)
     VALUES ($1, $2, 1)
     ON CONFLICT (entity_id, calendar_year)
     DO UPDATE SET last_value = transaction_number_counters.last_value + 1
     RETURNING last_value::text`,
    [entityId, year],
  );
  return `${entityCode}-${year}-${result.rows[0].last_value.padStart(6, "0")}`;
}

export async function GET(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!hasAnyPermission(actor, [
    "finance.transaction.read",
    "finance.transaction.create",
    "finance.transaction.validate",
    "finance.transaction.reverse",
  ])) {
    return NextResponse.json({ error: "Permission denied." }, { status: 403 });
  }
  const params = new URL(request.url).searchParams;
  const parsedFilters = transactionFiltersSchema.safeParse({
    from: params.get("from") || undefined,
    to: params.get("to") || undefined,
    type: params.get("type") || undefined,
    status: params.get("status") || undefined,
    search: params.get("search") || undefined,
    format: params.get("format") || undefined,
  });
  if (!parsedFilters.success) {
    return NextResponse.json({ error: "Invalid transaction filters." }, { status: 400 });
  }

  try {
    const data = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const entities = await client.query<{ id: string }>("SELECT id FROM entities");
      const visibleEntities = entities.rows.filter(({ id }) =>
        hasEntityPermission(actor, "finance.transaction.read", id)
        || hasEntityPermission(actor, "finance.transaction.create", id)
        || hasEntityPermission(actor, "finance.transaction.validate", id)
        || hasEntityPermission(actor, "finance.transaction.reverse", id),
      );
      const conditions = [
        "t.entity_id = ANY($1::uuid[])",
        "(t.entity_id = ANY($2::uuid[]) OR t.created_by = $3)",
      ];
      const values: (string | string[])[] = [
        visibleEntities.map(({ id }) => id),
        entities.rows.filter(({ id }) =>
          hasEntityPermission(actor, "finance.transaction.read", id)
          || hasEntityPermission(actor, "finance.transaction.validate", id)
          || hasEntityPermission(actor, "finance.transaction.reverse", id),
        ).map(({ id }) => id),
        actor.id,
      ];
      const addFilter = (condition: string, value: string) => {
        values.push(value);
        conditions.push(condition.replaceAll("?", `$${values.length}`));
      };
      if (parsedFilters.data.from) addFilter("t.tx_date >= ?::date", parsedFilters.data.from);
      if (parsedFilters.data.to) addFilter("t.tx_date <= ?::date", parsedFilters.data.to);
      if (parsedFilters.data.type) addFilter("t.tx_type = ?", parsedFilters.data.type);
      if (parsedFilters.data.status) addFilter("t.status = ?", parsedFilters.data.status);
      if (parsedFilters.data.search) {
        const escapedSearch = parsedFilters.data.search
          .replaceAll("\\", "\\\\")
          .replaceAll("%", "\\%")
          .replaceAll("_", "\\_");
        addFilter(
          `(t.tx_number ILIKE ? ESCAPE '\\'
            OR COALESCE(t.description, '') ILIKE ? ESCAPE '\\'
            OR e.name ILIKE ? ESCAPE '\\'
            OR a.name ILIKE ? ESCAPE '\\'
              OR COALESCE(c.name, '') ILIKE ? ESCAPE '\\')`,
            `%${escapedSearch}%`,
        );
      }
      const where = conditions.join(" AND ");
      const transactions = await client.query(
        `SELECT t.id, t.entity_id, e.name AS entity_name, t.tx_number, t.tx_date::text,
                t.tx_type, t.adjustment_direction, t.amount::text, t.currency, t.status, t.created_by, t.description,
                t.reversal_of_id, a.name AS account_name, c.name AS category_name,
                COALESCE((
                  SELECT jsonb_agg(jsonb_build_object('id', d.id, 'fileName', d.file_name) ORDER BY d.created_at)
                  FROM documents d
                  WHERE d.owner_table = 'transactions' AND d.owner_id = t.id
                    AND d.confidentiality = 'finance'
                ), '[]'::jsonb) AS documents,
                EXISTS (SELECT 1 FROM transactions reversal WHERE reversal.reversal_of_id = t.id) AS has_reversal,
                EXISTS (
                  SELECT 1 FROM approval_requests ar
                  WHERE ar.request_type = 'expense' AND ar.ref_table = 'transactions'
                    AND ar.ref_id = t.id AND ar.status = 'approved'
                ) AS has_approved_expense_request
         FROM transactions t
         JOIN entities e ON e.id = t.entity_id
         JOIN accounts a ON a.id = t.account_id
         LEFT JOIN transaction_categories c ON c.id = t.category_id
         WHERE ${where}
         ORDER BY t.tx_date DESC, t.created_at DESC
         LIMIT ${parsedFilters.data.format === "csv" ? 10_001 : 100}`,
        values,
      );
      const rows = parsedFilters.data.format === "csv"
        ? transactions.rows.slice(0, 10_000)
        : transactions.rows;
      if (parsedFilters.data.format === "csv") {
        const content = [
          ["number", "date", "entity", "type", "account", "category", "amount", "currency", "status", "description", "supporting_documents"]
            .map(csvCell).join(","),
          ...rows.map((transaction) => [
            transaction.tx_number,
            transaction.tx_date,
            transaction.entity_name,
            transaction.tx_type === "adjustment"
              ? `adjustment_${transaction.adjustment_direction}`
              : transaction.tx_type,
            transaction.account_name,
            transaction.category_name,
            transaction.amount,
            transaction.currency,
            transaction.status,
            transaction.description,
            transaction.documents.map((document: { fileName: string }) => document.fileName).join("; "),
          ].map(csvCell).join(",")),
        ].join("\r\n");
        return {
          kind: "csv" as const,
          response: new Response(`\uFEFF${content}`, {
            headers: {
              "content-type": "text/csv; charset=utf-8",
              "content-disposition": `attachment; filename="${transactions.rows.length > 10_000 ? "mojo-transactions-truncated.csv" : "mojo-transactions.csv"}"`,
              "x-export-truncated": String(transactions.rows.length > 10_000),
            },
          }),
        };
      }
      return {
        kind: "json" as const,
        transactions: rows.map((transaction) => ({
          ...transaction,
          canValidate: transaction.created_by !== actor.id
            && (transaction.status === "draft"
              || (transaction.status === "pending_approval" && transaction.has_approved_expense_request))
            && hasEntityPermission(actor, "finance.transaction.validate", transaction.entity_id),
          canSubmitApproval: transaction.tx_type === "expense"
            && transaction.status === "draft"
            && transaction.created_by === actor.id
            && hasEntityPermission(actor, "finance.transaction.create", transaction.entity_id),
          canReverse: transaction.status === "validated"
            && (transaction.tx_type === "income" || transaction.tx_type === "expense" || transaction.tx_type === "adjustment")
            && transaction.reversal_of_id === null
            && !transaction.has_reversal
            && hasEntityPermission(actor, "finance.transaction.reverse", transaction.entity_id),
        })),
      };
    });
    if ("kind" in data && data.kind === "csv") return data.response;
    return NextResponse.json({ transactions: data.transactions });
  } catch (error) {
    console.error("Unable to load finance transactions.", error);
    return NextResponse.json({ error: "Unable to load finance transactions." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const parsed = createTransactionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid transaction details." }, { status: 400 });
  if (!hasEntityPermission(actor, "finance.transaction.create", parsed.data.entityId)) {
    return NextResponse.json({ error: "Permission denied for this entity." }, { status: 403 });
  }

  try {
    const created = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      if (!await hasEntityPermissionInDatabase(client, "finance.transaction.create", parsed.data.entityId)) {
        throw new TransactionPolicyError("Permission denied for this entity.", 403);
      }
      const accountResult = await client.query<{
        currency: string;
        account_type: string;
        cash_ceiling: string | null;
        cash_variance_tolerance: string | null;
      }>(
        `SELECT currency, account_type, cash_ceiling::text, cash_variance_tolerance::text
         FROM accounts WHERE id = $1 AND entity_id = $2 AND is_active
         FOR UPDATE`,
        [parsed.data.accountId, parsed.data.entityId],
      );
      if (!accountResult.rowCount) {
        throw new TransactionPolicyError("The selected account is unavailable for this entity.", 400);
      }
      if (accountResult.rows[0].account_type === "cash") {
        if (!accountResult.rows[0].cash_ceiling || accountResult.rows[0].cash_variance_tolerance === null) {
          throw new TransactionPolicyError("Configure the cash ceiling and count tolerance before operating this account.", 409);
        }
        const session = await client.query<{ status: string }>(
          "SELECT status FROM cash_sessions WHERE account_id = $1 AND session_date = $2 FOR UPDATE",
          [parsed.data.accountId, parsed.data.date],
        );
        if (session.rows[0]?.status !== "open") {
          throw new TransactionPolicyError("Open the cash session before entering transactions for this date.", 409);
        }
      }
      const entityResult = await client.query<{ code: string }>(
        "SELECT code FROM entities WHERE id = $1 AND is_active",
        [parsed.data.entityId],
      );
      if (!entityResult.rowCount) {
        throw new TransactionPolicyError("The selected entity is unavailable.", 400);
      }
      const currency = accountResult.rows[0].currency;
      if (parsed.data.categoryId) {
        const categoryKind = parsed.data.type === "adjustment"
          ? parsed.data.adjustmentDirection === "increase" ? "income" : "expense"
          : parsed.data.type;
        const category = await client.query(
          `SELECT id FROM transaction_categories
           WHERE id = $1 AND is_active AND kind = $2
             AND (entity_id IS NULL OR entity_id = $3)`,
          [parsed.data.categoryId, categoryKind, parsed.data.entityId],
        );
        if (!category.rowCount) {
          throw new TransactionPolicyError("The selected category is unavailable for this transaction.", 400);
        }
      }
      const fxRateToUsd = await exchangeRateToUsd(client, currency, parsed.data.date);
      if (!fxRateToUsd) {
        throw new TransactionPolicyError(`No exchange rate is available for ${parsed.data.date}.`, 400);
      }
      const txNumber = await nextTransactionNumber(
        client,
        parsed.data.entityId,
        entityResult.rows[0].code,
        Number(parsed.data.date.slice(0, 4)),
      );
      const transaction = await client.query<{ id: string }>(
        `INSERT INTO transactions(
           entity_id, tx_number, tx_type, tx_date, account_id, category_id, amount, currency,
           fx_rate_to_usd, description, status, created_by, adjustment_direction
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7::numeric, $8, $9::numeric, $10, 'draft', $11, $12)
         RETURNING id`,
        [
          parsed.data.entityId,
          txNumber,
          parsed.data.type,
          parsed.data.date,
          parsed.data.accountId,
          parsed.data.categoryId,
          parsed.data.amount,
          currency,
          fxRateToUsd,
          parsed.data.description,
          actor.id,
          parsed.data.type === "adjustment" ? parsed.data.adjustmentDirection : null,
        ],
      );
      return { id: transaction.rows[0].id, txNumber };
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof TransactionPolicyError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Unable to create finance transaction.", error);
    return NextResponse.json({ error: "Unable to create finance transaction." }, { status: 500 });
  }
}
