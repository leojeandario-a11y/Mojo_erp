import { NextResponse } from "next/server";
import { z } from "zod";
import type { PoolClient } from "pg";
import { getSession } from "@/lib/auth";
import { hasEntityPermission } from "@/lib/permissions";
import { requestIp, withDbUser } from "@/lib/db";
import { invertExchangeRate } from "@/lib/money.mjs";

const transferSchema = z.object({
  fromAccountId: z.uuid(),
  toAccountId: z.uuid(),
  date: z.iso.date(),
  amount: z.string().regex(/^\d{1,16}(?:\.\d{1,2})?$/).refine((value) => Number(value) > 0),
  description: z.string().trim().max(500).nullable(),
}).strict().refine((data) => data.fromAccountId !== data.toAccountId);

class TransferError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function nextTransactionNumber(client: PoolClient, entityId: string, code: string, year: number) {
  const result = await client.query<{ last_value: string }>(
    `INSERT INTO transaction_number_counters(entity_id, calendar_year, last_value)
     VALUES ($1, $2, 1)
     ON CONFLICT (entity_id, calendar_year)
     DO UPDATE SET last_value = transaction_number_counters.last_value + 1
     RETURNING last_value::text`,
    [entityId, year],
  );
  return `${code}-${year}-${result.rows[0].last_value.padStart(6, "0")}`;
}

async function exchangeRateToUsd(client: PoolClient, currency: string, date: string) {
  if (currency === "USD") return "1.00000000";
  const result = await client.query<{ from_currency: string; rate: string }>(
    `SELECT from_currency, rate::text
     FROM exchange_rates
     WHERE rate_date <= $1
       AND ((from_currency = 'USD' AND to_currency = 'HTG')
         OR (from_currency = 'HTG' AND to_currency = 'USD'))
     ORDER BY rate_date DESC, created_at DESC
     LIMIT 1`,
    [date],
  );
  const rate = result.rows[0];
  if (!rate) throw new TransferError(`No exchange rate is available for ${date}.`, 400);
  return rate.from_currency === "HTG" ? rate.rate : invertExchangeRate(rate.rate);
}

export async function POST(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const parsed = transferSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid transfer details." }, { status: 400 });

  try {
    const transfer = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const ids = [parsed.data.fromAccountId, parsed.data.toAccountId].sort();
      const accounts = await client.query<{
        id: string;
        entity_id: string;
        account_type: string;
        currency: string;
        is_active: boolean;
        cash_ceiling: string | null;
        cash_variance_tolerance: string | null;
      }>(
        `SELECT id, entity_id, account_type, currency, is_active,
                cash_ceiling::text, cash_variance_tolerance::text
         FROM accounts WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
        [ids],
      );
      if (accounts.rowCount !== 2) throw new TransferError("Both accounts must exist.", 404);
      const from = accounts.rows.find(({ id }) => id === parsed.data.fromAccountId)!;
      const to = accounts.rows.find(({ id }) => id === parsed.data.toAccountId)!;
      if (!from.is_active || !to.is_active
          || from.entity_id !== to.entity_id
          || from.currency !== to.currency) {
        throw new TransferError("Transfers require active accounts in the same entity and currency.", 400);
      }
      if (!hasEntityPermission(actor, "finance.transaction.create", from.entity_id)) {
        throw new TransferError("Permission denied for this entity.", 403);
      }
      const permission = await client.query<{ allowed: boolean }>(
        "SELECT app_has_entity_permission('finance.transaction.create', $1::uuid) AS allowed",
        [from.entity_id],
      );
      if (!permission.rows[0]?.allowed) throw new TransferError("Permission denied for this entity.", 403);

      for (const account of [from, to].filter(({ account_type }) => account_type === "cash")) {
        if (!account.cash_ceiling || account.cash_variance_tolerance === null) {
          throw new TransferError("Configure the cash ceiling and count tolerance before operating this account.", 409);
        }
        const session = await client.query<{ status: string }>(
          "SELECT status FROM cash_sessions WHERE account_id = $1 AND session_date = $2 FOR UPDATE",
          [account.id, parsed.data.date],
        );
        if (session.rows[0]?.status !== "open") {
          throw new TransferError("Open the cash session before transferring to or from this account.", 409);
        }
      }

      const entity = await client.query<{ code: string }>(
        "SELECT code FROM entities WHERE id = $1 AND is_active",
        [from.entity_id],
      );
      if (!entity.rowCount) throw new TransferError("Entity is unavailable.", 400);
      const fxRate = await exchangeRateToUsd(client, from.currency, parsed.data.date);
      const created = await client.query<{ id: string }>(
        `INSERT INTO account_transfers(
           entity_id, from_account_id, to_account_id, transfer_date, amount,
           currency, description, created_by
         )
         VALUES ($1, $2, $3, $4, $5::numeric, $6, $7, $8)
         RETURNING id`,
        [
          from.entity_id,
          from.id,
          to.id,
          parsed.data.date,
          parsed.data.amount,
          from.currency,
          parsed.data.description,
          actor.id,
        ],
      );
      const transferId = created.rows[0].id;
      const year = Number(parsed.data.date.slice(0, 4));
      const outNumber = await nextTransactionNumber(client, from.entity_id, entity.rows[0].code, year);
      const inNumber = await nextTransactionNumber(client, from.entity_id, entity.rows[0].code, year);
      const transactions = await client.query<{ id: string; tx_number: string; tx_type: string }>(
        `INSERT INTO transactions(
           entity_id, tx_number, tx_type, tx_date, account_id, amount, currency,
           fx_rate_to_usd, description, status, created_by, account_transfer_id
         )
         VALUES
           ($1, $2, 'transfer_out', $3, $4, $5::numeric, $6, $7::numeric, $8, 'draft', $9, $10),
           ($1, $11, 'transfer_in', $3, $12, $5::numeric, $6, $7::numeric, $8, 'draft', $9, $10)
         RETURNING id, tx_number, tx_type`,
        [
          from.entity_id,
          outNumber,
          parsed.data.date,
          from.id,
          parsed.data.amount,
          from.currency,
          fxRate,
          parsed.data.description ?? `Transfer ${from.id} to ${to.id}`,
          actor.id,
          transferId,
          inNumber,
          to.id,
        ],
      );
      return { id: transferId, transactions: transactions.rows };
    });
    return NextResponse.json({ transfer }, { status: 201 });
  } catch (error) {
    if (error instanceof TransferError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Unable to create account transfer.", error);
    return NextResponse.json({ error: "Unable to create account transfer." }, { status: 500 });
  }
}
