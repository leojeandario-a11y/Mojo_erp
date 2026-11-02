import { NextResponse } from "next/server";
import { z } from "zod";
import type { PoolClient } from "pg";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { hasEntityPermission } from "@/lib/permissions";

const fundConfigurationSchema = z.object({
  accountId: z.uuid(),
  targetAmount: z.string().regex(/^\d{1,16}(?:\.\d{1,2})?$/).nullable(),
}).strict().refine((value) => value.targetAmount === null || Number(value.targetAmount) > 0);

class FundPolicyError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function hasEntityPermissionInDatabase(
  client: PoolClient,
  permission: string,
  entityId: string,
) {
  const result = await client.query<{ allowed: boolean }>(
    "SELECT app_has_entity_permission($1, $2::uuid) AS allowed",
    [permission, entityId],
  );
  return result.rows[0]?.allowed === true;
}

async function hasAnyFundPermission(
  client: PoolClient,
  actor: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  permissions: string[],
  entityId: string,
) {
  const actorPermissions = permissions.filter((permission) => hasEntityPermission(actor, permission, entityId));
  const results = await Promise.all(
    actorPermissions.map((permission) => hasEntityPermissionInDatabase(client, permission, entityId)),
  );
  return results.some(Boolean);
}

async function fundEntity(client: PoolClient) {
  const result = await client.query<{ id: string }>(
    "SELECT id FROM entities WHERE code = 'MOJO' AND is_active",
  );
  if (!result.rowCount) throw new FundPolicyError("The MoJoPIKtures entity is unavailable.", 409);
  return result.rows[0].id;
}

export async function GET(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  try {
    const data = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const entityId = await fundEntity(client);
      const fundPermissions = [
        "finance.fund.read",
        "finance.fund.contribute",
        "finance.fund.request_withdrawal",
        "finance.fund.approve_withdrawal",
        "finance.fund.set_rate",
      ].filter((permission) => hasEntityPermission(actor, permission, entityId));
      const canReadFund = hasEntityPermission(actor, "finance.fund.read", entityId);
      const canConfigure = hasEntityPermission(actor, "finance.account.manage", entityId)
        && hasEntityPermission(actor, "finance.transaction.read", entityId);
      if (!fundPermissions.length && !canConfigure) {
        throw new FundPolicyError("Permission denied for the emergency fund.", 403);
      }

      const canReadInDatabase = await Promise.all(
        fundPermissions.map((permission) => hasEntityPermissionInDatabase(client, permission, entityId)),
      ).then((allowed) => allowed.some(Boolean));
      const canReadFundInDatabase = canReadFund
        && await hasEntityPermissionInDatabase(client, "finance.fund.read", entityId);
      const canConfigureInDatabase = canConfigure
        && await hasEntityPermissionInDatabase(client, "finance.account.manage", entityId)
        && await hasEntityPermissionInDatabase(client, "finance.transaction.read", entityId);
      if (!canReadInDatabase && !canConfigureInDatabase) {
        throw new FundPolicyError("Permission denied for the emergency fund.", 403);
      }

      const fundResult = await client.query<{
        id: string;
        name: string;
        target_amount: string | null;
        currency: string;
        account_id: string | null;
        account_name: string | null;
        balance: string;
        percentage: string | null;
        effective_from: string | null;
        progress_percentage: string | null;
      }>(
        `SELECT f.id, f.name, f.target_amount::text, f.currency, f.account_id,
                a.name AS account_name, balance.balance::text,
                rate.percentage::text, rate.effective_from::text,
                CASE WHEN f.target_amount > 0
                  THEN round(balance.balance * 100 / f.target_amount, 2)::text
                  ELSE NULL END AS progress_percentage
         FROM emergency_funds f
         JOIN v_fund_balance balance ON balance.fund_id = f.id
         LEFT JOIN accounts a ON a.id = f.account_id
         LEFT JOIN LATERAL (
           SELECT percentage, effective_from
           FROM emergency_fund_rates
           WHERE fund_id = f.id AND approval_status = 'approved'
             AND effective_from <= CURRENT_DATE
           ORDER BY effective_from DESC, created_at DESC
           LIMIT 1
         ) rate ON true
         WHERE f.entity_id = $1 AND f.is_active`,
        [entityId],
      );

      const accountResult = canConfigureInDatabase
        ? await client.query<{
          id: string;
          name: string;
          currency: string;
          available: boolean;
        }>(
          `SELECT a.id, a.name, a.currency,
                  (a.id = f.account_id OR (
                    a.opening_balance = 0
                    AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.account_id = a.id)
                    AND NOT EXISTS (
                      SELECT 1 FROM emergency_funds other
                      WHERE other.account_id = a.id AND other.id <> f.id
                    )
                  )) AS available
           FROM accounts a
           LEFT JOIN emergency_funds f ON f.entity_id = $1
           WHERE a.entity_id = $1 AND a.is_active
           ORDER BY a.name`,
          [entityId],
        )
        : { rows: [] };

      let canChangeAccount = true;
      if (fundResult.rows[0]) {
        const activityResult = await client.query<{ has_activity: boolean }>(
          `SELECT EXISTS (SELECT 1 FROM fund_contributions WHERE fund_id = $1)
              OR EXISTS (SELECT 1 FROM fund_withdrawals WHERE fund_id = $1) AS has_activity`,
          [fundResult.rows[0].id],
        );
        canChangeAccount = !activityResult.rows[0].has_activity;
      }

      return {
        fund: fundResult.rows[0] ?? null,
        accounts: accountResult.rows,
        canReadRates: await hasAnyFundPermission(client, actor, ["finance.fund.read", "finance.fund.set_rate"], entityId),
        canReadContributions: await hasAnyFundPermission(
          client,
          actor,
          ["finance.fund.read", "finance.fund.contribute", "finance.fund.request_withdrawal"],
          entityId,
        ),
        canReadWithdrawals: await hasAnyFundPermission(
          client,
          actor,
          ["finance.fund.read", "finance.fund.request_withdrawal", "finance.fund.approve_withdrawal"],
          entityId,
        ),
        canReadReports: canReadFundInDatabase,
        canConfigure: canConfigureInDatabase,
        canChangeAccount,
      };
    });
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof FundPolicyError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Unable to load the emergency fund.", error);
    return NextResponse.json({ error: "Unable to load the emergency fund." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const parsed = fundConfigurationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid emergency fund configuration." }, { status: 400 });

  try {
    const fund = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const entityId = await fundEntity(client);
      if (!hasEntityPermission(actor, "finance.account.manage", entityId)
          || !hasEntityPermission(actor, "finance.transaction.read", entityId)
          || !await hasEntityPermissionInDatabase(client, "finance.account.manage", entityId)
          || !await hasEntityPermissionInDatabase(client, "finance.transaction.read", entityId)) {
        throw new FundPolicyError("Permission denied for the emergency fund configuration.", 403);
      }

      const accountResult = await client.query<{
        currency: string;
        opening_balance: string;
        is_active: boolean;
      }>(
        `SELECT currency, opening_balance::text, is_active
         FROM accounts
         WHERE id = $1 AND entity_id = $2
         FOR UPDATE`,
        [parsed.data.accountId, entityId],
      );
      if (!accountResult.rowCount || !accountResult.rows[0].is_active) {
        throw new FundPolicyError("Choose an active account belonging to MoJoPIKtures.", 400);
      }

      const existingResult = await client.query<{
        id: string;
        account_id: string | null;
        has_activity: boolean;
      }>(
        `SELECT f.id, f.account_id,
                EXISTS (SELECT 1 FROM fund_contributions c WHERE c.fund_id = f.id)
                OR EXISTS (SELECT 1 FROM fund_withdrawals w WHERE w.fund_id = f.id) AS has_activity
         FROM emergency_funds f
         WHERE f.entity_id = $1
         FOR UPDATE`,
        [entityId],
      );
      const existing = existingResult.rows[0];
      const changingAccount = existing?.account_id !== parsed.data.accountId;
      if (existing?.has_activity && changingAccount) {
        throw new FundPolicyError("The fund account cannot be changed after fund activity has been recorded.", 409);
      }

      if (changingAccount) {
        const accountUse = await client.query<{ in_use: boolean }>(
          `SELECT EXISTS (SELECT 1 FROM transactions WHERE account_id = $1)
              OR EXISTS (SELECT 1 FROM emergency_funds WHERE account_id = $1) AS in_use`,
          [parsed.data.accountId],
        );
        if (accountUse.rows[0].in_use || Number(accountResult.rows[0].opening_balance) !== 0) {
          throw new FundPolicyError("The fund must use a dedicated, unused account with a zero opening balance.", 409);
        }
      }

      const result = existing
        ? await client.query<{ id: string; currency: string }>(
          `UPDATE emergency_funds
           SET account_id = $2, currency = $3, target_amount = $4::numeric, is_active = true
           WHERE id = $1
           RETURNING id, currency`,
          [existing.id, parsed.data.accountId, accountResult.rows[0].currency, parsed.data.targetAmount],
        )
        : await client.query<{ id: string; currency: string }>(
          `INSERT INTO emergency_funds(entity_id, account_id, currency, target_amount)
           VALUES ($1, $2, $3, $4::numeric)
           RETURNING id, currency`,
          [entityId, parsed.data.accountId, accountResult.rows[0].currency, parsed.data.targetAmount],
        );
      return result.rows[0];
    });
    return NextResponse.json({ fund });
  } catch (error) {
    if (error instanceof FundPolicyError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
      return NextResponse.json({ error: "The emergency fund is already configured." }, { status: 409 });
    }
    console.error("Unable to configure the emergency fund.", error);
    return NextResponse.json({ error: "Unable to configure the emergency fund." }, { status: 500 });
  }
}
