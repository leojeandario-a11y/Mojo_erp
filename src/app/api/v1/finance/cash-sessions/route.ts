import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { hasAnyPermission, hasEntityPermission } from "@/lib/permissions";
import { requestIp, withDbUser } from "@/lib/db";

const sessionSchema = z.object({
  action: z.enum(["open", "close"]),
  accountId: z.uuid(),
  date: z.iso.date(),
  countedAmount: z.string().regex(/^\d{1,16}(?:\.\d{1,2})?$/),
}).strict();

class CashSessionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function GET(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!hasAnyPermission(actor, ["finance.transaction.read", "finance.transaction.create", "finance.account.manage"])) {
    return NextResponse.json({ error: "Permission denied." }, { status: 403 });
  }
  const requestedDate = new URL(request.url).searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  if (!z.iso.date().safeParse(requestedDate).success) {
    return NextResponse.json({ error: "Invalid cash-session date." }, { status: 400 });
  }

  try {
    const data = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const accounts = await client.query<{
        id: string;
        entity_id: string;
        entity_name: string;
        name: string;
        currency: string;
        cash_ceiling: string | null;
        cash_variance_tolerance: string | null;
        balance: string;
        session_id: string | null;
        session_status: "open" | "closed" | null;
        opening_count: string | null;
        opening_expected: string | null;
        closing_count: string | null;
        closing_expected: string | null;
      }>(
        `SELECT a.id, a.entity_id, e.name AS entity_name, a.name, a.currency,
                a.cash_ceiling::text, a.cash_variance_tolerance::text, b.balance::text,
                s.id AS session_id, s.status AS session_status,
                s.opening_count::text, s.opening_expected::text,
                s.closing_count::text, s.closing_expected::text
         FROM accounts a
         JOIN entities e ON e.id = a.entity_id
         JOIN v_account_balances b ON b.account_id = a.id
         LEFT JOIN cash_sessions s ON s.account_id = a.id AND s.session_date = $1
         WHERE a.account_type = 'cash' AND a.is_active
         ORDER BY e.name, a.name`,
        [requestedDate],
      );
      return {
        accounts: accounts.rows.filter(({ entity_id }) =>
          hasEntityPermission(actor, "finance.transaction.read", entity_id)
          || hasEntityPermission(actor, "finance.transaction.create", entity_id)
          || hasEntityPermission(actor, "finance.account.manage", entity_id),
        ),
        date: requestedDate,
      };
    });
    return NextResponse.json(data);
  } catch (error) {
    console.error("Unable to load cash sessions.", error);
    return NextResponse.json({ error: "Unable to load cash sessions." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const parsed = sessionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid cash-session details." }, { status: 400 });

  try {
    const result = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const accountResult = await client.query<{
        entity_id: string;
        account_type: string;
        is_active: boolean;
        cash_ceiling: string | null;
        cash_variance_tolerance: string | null;
      }>(
        `SELECT entity_id, account_type, is_active, cash_ceiling::text, cash_variance_tolerance::text
         FROM accounts WHERE id = $1 FOR UPDATE`,
        [parsed.data.accountId],
      );
      if (!accountResult.rowCount) throw new CashSessionError("Cash account not found.", 404);
      const account = accountResult.rows[0];
      if (!hasEntityPermission(actor, "finance.transaction.create", account.entity_id)) {
        throw new CashSessionError("Permission denied for this entity.", 403);
      }
      const permission = await client.query<{ allowed: boolean }>(
        "SELECT app_has_entity_permission('finance.transaction.create', $1::uuid) AS allowed",
        [account.entity_id],
      );
      if (!permission.rows[0]?.allowed) {
        throw new CashSessionError("Permission denied for this entity.", 403);
      }
      if (account.account_type !== "cash" || !account.is_active) {
        throw new CashSessionError("An active cash account is required.", 400);
      }
      if (!account.cash_ceiling || account.cash_variance_tolerance === null) {
        throw new CashSessionError("Configure the cash ceiling and count tolerance before operating this account.", 409);
      }

      if (parsed.data.action === "open") {
        const existing = await client.query(
          "SELECT 1 FROM cash_sessions WHERE account_id = $1 AND session_date = $2",
          [parsed.data.accountId, parsed.data.date],
        );
        if (existing.rowCount) throw new CashSessionError("A session already exists for this account and date.", 409);

        const expected = await client.query<{ balance: string }>(
          `SELECT (
             a.opening_balance + COALESCE(SUM(
               CASE
                 WHEN t.tx_type IN ('income','transfer_in') THEN t.amount
                 WHEN t.tx_type IN ('expense','transfer_out') THEN -t.amount
                 WHEN t.tx_type = 'adjustment' AND t.adjustment_direction = 'increase' THEN t.amount
                 WHEN t.tx_type = 'adjustment' AND t.adjustment_direction = 'decrease' THEN -t.amount
                 ELSE 0
               END
             ), 0)
           )::text AS balance
           FROM accounts a
           LEFT JOIN transactions t ON t.account_id = a.id
             AND t.tx_date < $2
             AND t.status IN ('validated', 'reversed')
           WHERE a.id = $1
           GROUP BY a.id`,
          [parsed.data.accountId, parsed.data.date],
        );
        const variance = await client.query<{ exceeds: boolean }>(
          "SELECT abs($1::numeric - $2::numeric) > $3::numeric AS exceeds",
          [parsed.data.countedAmount, expected.rows[0].balance, account.cash_variance_tolerance],
        );
        if (variance.rows[0].exceeds) {
          throw new CashSessionError("Opening count exceeds the configured cash tolerance.", 409);
        }
        const opened = await client.query<{ id: string; status: string }>(
          `INSERT INTO cash_sessions(account_id, session_date, opening_count, opening_expected, opened_by)
           VALUES ($1, $2, $3::numeric, $4::numeric, $5)
           RETURNING id, status`,
          [parsed.data.accountId, parsed.data.date, parsed.data.countedAmount, expected.rows[0].balance, actor.id],
        );
        return opened.rows[0];
      }

      const sessionResult = await client.query<{
        id: string;
        opening_count: string;
        status: string;
      }>(
        `SELECT id, opening_count::text, status
         FROM cash_sessions
         WHERE account_id = $1 AND session_date = $2
         FOR UPDATE`,
        [parsed.data.accountId, parsed.data.date],
      );
      if (!sessionResult.rowCount) throw new CashSessionError("Open a cash session before closing it.", 409);
      const session = sessionResult.rows[0];
      if (session.status !== "open") throw new CashSessionError("This cash session is already closed.", 409);
      const drafts = await client.query(
        `SELECT 1 FROM transactions
         WHERE account_id = $1 AND tx_date = $2 AND status IN ('draft','pending_approval')
         LIMIT 1`,
        [parsed.data.accountId, parsed.data.date],
      );
      if (drafts.rowCount) throw new CashSessionError("Resolve pending transactions before closing the cash session.", 409);

      const expected = await client.query<{ balance: string }>(
        `SELECT (
           $3::numeric + COALESCE(SUM(
             CASE
               WHEN tx_type IN ('income','transfer_in') THEN amount
               WHEN tx_type IN ('expense','transfer_out') THEN -amount
               WHEN tx_type = 'adjustment' AND adjustment_direction = 'increase' THEN amount
               WHEN tx_type = 'adjustment' AND adjustment_direction = 'decrease' THEN -amount
               ELSE 0
             END
           ), 0)
         )::text AS balance
         FROM transactions
         WHERE account_id = $1 AND tx_date = $2 AND status IN ('validated', 'reversed')`,
        [parsed.data.accountId, parsed.data.date, session.opening_count],
      );
      const variance = await client.query<{ exceeds: boolean }>(
        "SELECT abs($1::numeric - $2::numeric) > $3::numeric AS exceeds",
        [parsed.data.countedAmount, expected.rows[0].balance, account.cash_variance_tolerance],
      );
      if (variance.rows[0].exceeds) {
        throw new CashSessionError("Closing count exceeds the configured cash tolerance.", 409);
      }
      await client.query(
        `UPDATE cash_sessions
         SET closing_count = $2::numeric, closing_expected = $3::numeric,
             closed_by = $4, closed_at = now(), status = 'closed'
         WHERE id = $1`,
        [session.id, parsed.data.countedAmount, expected.rows[0].balance, actor.id],
      );
      return { id: session.id, status: "closed" };
    });
    return NextResponse.json({ session: result }, { status: parsed.data.action === "open" ? 201 : 200 });
  } catch (error) {
    if (error instanceof CashSessionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Unable to save cash session.", error);
    return NextResponse.json({ error: "Unable to save cash session." }, { status: 500 });
  }
}
