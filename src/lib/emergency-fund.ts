import "server-only";
import type { PoolClient } from "pg";
import { getNextApprovalStep, getStepApproverIds, notifyApprovalUsers } from "@/lib/approvals";
import { exchangeRateToUsd } from "@/lib/finance-exchange-rates";
import { convertMoney, invertExchangeRate } from "@/lib/money.mjs";

export class EmergencyFundError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export interface EmergencyFundRow {
  id: string;
  entity_id: string;
  account_id: string | null;
  currency: string;
  name: string;
  target_amount: string | null;
}

function isFundCurrency(currency: string): currency is "HTG" | "USD" {
  return currency === "HTG" || currency === "USD";
}

export async function getEmergencyFund(client: PoolClient, lock = false): Promise<EmergencyFundRow> {
  const result = await client.query<EmergencyFundRow>(
    `SELECT id, entity_id, account_id, currency, name, target_amount::text
     FROM emergency_funds
     WHERE entity_id = (SELECT id FROM entities WHERE code = 'MOJO' AND is_active)
       AND is_active
     ${lock ? "FOR UPDATE" : ""}`,
  );
  if (!result.rowCount) throw new EmergencyFundError("The MoJoPIKtures emergency fund is not configured.", 409);
  return result.rows[0];
}

export async function requireFundPermission(client: PoolClient, permission: string, entityId: string) {
  const result = await client.query<{ allowed: boolean }>(
    "SELECT app_has_entity_permission($1, $2::uuid) AS allowed",
    [permission, entityId],
  );
  if (!result.rows[0]?.allowed) throw new EmergencyFundError("Permission denied for the emergency fund.", 403);
}

export async function nextFundTransactionNumber(
  client: PoolClient,
  entityId: string,
  date: string,
) {
  const entity = await client.query<{ code: string }>(
    "SELECT code FROM entities WHERE id = $1 AND is_active",
    [entityId],
  );
  if (!entity.rowCount) throw new EmergencyFundError("The fund entity is unavailable.", 409);
  const year = Number(date.slice(0, 4));
  const counter = await client.query<{ last_value: string }>(
    `INSERT INTO transaction_number_counters(entity_id, calendar_year, last_value)
     VALUES ($1, $2, 1)
     ON CONFLICT (entity_id, calendar_year)
     DO UPDATE SET last_value = transaction_number_counters.last_value + 1
     RETURNING last_value::text`,
    [entityId, year],
  );
  return `${entity.rows[0].code}-${year}-${counter.rows[0].last_value.padStart(6, "0")}`;
}

export async function historicalRateToUsd(client: PoolClient, currency: string, date: string) {
  const rate = await exchangeRateToUsd(client, currency, date);
  if (rate === null) {
    throw new EmergencyFundError(`No exchange rate is available for ${date}.`, 409);
  }
  return rate;
}

export async function convertFundCurrency(
  client: PoolClient,
  amount: string,
  fromCurrency: string,
  toCurrency: string,
  date: string,
) {
  if (!isFundCurrency(fromCurrency) || !isFundCurrency(toCurrency)) {
    throw new EmergencyFundError("The emergency fund supports only HTG and USD.", 409);
  }
  if (fromCurrency === toCurrency) return amount;
  const rate = await client.query<{ from_currency: string; rate: string }>(
    `SELECT from_currency, rate::text
     FROM exchange_rates
     WHERE rate_date <= $1
       AND ((from_currency = 'USD' AND to_currency = 'HTG')
         OR (from_currency = 'HTG' AND to_currency = 'USD'))
     ORDER BY rate_date DESC, created_at DESC
     LIMIT 1`,
    [date],
  );
  if (!rate.rowCount) throw new EmergencyFundError(`No exchange rate is available for ${date}.`, 409);
  const htgPerUsd = rate.rows[0].from_currency === "USD"
    ? rate.rows[0].rate
    : invertExchangeRate(rate.rows[0].rate);
  const converted = convertMoney(amount, fromCurrency, toCurrency, htgPerUsd);
  if (converted === null) throw new EmergencyFundError(`No exchange rate is available for ${date}.`, 409);
  return converted;
}

export async function getFundApprovalWorkflow(
  client: PoolClient,
  requestType: "fund_rate" | "fund_withdrawal",
  entityId: string,
  requesterId: string,
  amountUsd: string,
) {
  const workflow = await client.query<{ id: string }>(
    `SELECT id FROM approval_workflows
     WHERE request_type = $1 AND is_active
       AND (entity_id = $2 OR entity_id IS NULL)
     ORDER BY (entity_id IS NOT NULL) DESC, id
     LIMIT 1`,
    [requestType, entityId],
  );
  if (!workflow.rowCount) {
    throw new EmergencyFundError(`No active ${requestType} approval workflow is configured.`, 409);
  }
  const step = await getNextApprovalStep(client, workflow.rows[0].id, 0, amountUsd);
  if (!step) throw new EmergencyFundError("The fund approval workflow has no applicable step.", 409);
  const approverIds = (await getStepApproverIds(client, step, entityId))
    .filter((userId) => userId !== requesterId);
  if (!approverIds.length) {
    throw new EmergencyFundError("No eligible approver is configured for the fund workflow.", 409);
  }
  return { workflowId: workflow.rows[0].id, step, approverIds };
}

export async function notifyFundApprovers(
  client: PoolClient,
  approverIds: string[],
  title: { fr: string; ht: string; en: string },
  body: { fr: string; ht: string; en: string },
  refId: string,
) {
  await notifyApprovalUsers(client, approverIds, {
    kind: "approval_needed",
    title,
    body,
    link: "/modules/approvals",
    refTable: "approval_requests",
    refId,
  });
}

export async function notifyFundRequesters(
  client: PoolClient,
  requesterId: string,
  title: { fr: string; ht: string; en: string },
  body: { fr: string; ht: string; en: string },
  refId: string,
) {
  await notifyApprovalUsers(client, [requesterId], {
    kind: "system",
    title,
    body,
    link: "/modules/finance",
    refTable: "approval_requests",
    refId,
  });
}

export async function warnFundApproversAboutMissingRate(
  client: PoolClient,
  fund: EmergencyFundRow,
  transactionDate: string,
) {
  const workflow = await client.query<{ id: string }>(
    `SELECT id FROM approval_workflows
     WHERE request_type = 'fund_rate' AND is_active
       AND (entity_id = $1 OR entity_id IS NULL)
     ORDER BY (entity_id IS NOT NULL) DESC, id
     LIMIT 1`,
    [fund.entity_id],
  );
  if (!workflow.rowCount) return 0;
  const step = await client.query<{
    step_order: number;
    label: string;
    approver_role_id: string | null;
    approver_user_id: string | null;
    min_amount_usd: string | null;
  }>(
    `SELECT step_order, label, approver_role_id, approver_user_id, min_amount_usd::text
     FROM approval_workflow_steps
     WHERE workflow_id = $1 ORDER BY step_order LIMIT 1`,
    [workflow.rows[0].id],
  );
  if (!step.rowCount) return 0;
  const recipients = await getStepApproverIds(client, step.rows[0], fund.entity_id);
  let created = 0;
  for (const recipientId of recipients) {
    const eventKey = `fund-rate-missing:${fund.id}:${transactionDate.slice(0, 7)}:${recipientId}`;
    const delivery = await client.query(
      `INSERT INTO scheduled_notification_deliveries(event_key, recipient_id)
       VALUES ($1, $2) ON CONFLICT (event_key) DO NOTHING RETURNING event_key`,
      [eventKey, recipientId],
    );
    if (!delivery.rowCount) continue;
    const notification = await client.query(
      `INSERT INTO notifications(user_id, kind, title, body, link, ref_table, ref_id)
       SELECT id, 'system',
              CASE locale WHEN 'ht' THEN 'Pa gen to pou fon ijans lan'
                WHEN 'en' THEN 'Emergency fund rate missing' ELSE 'Taux du fonds d’urgence manquant' END,
              CASE locale WHEN 'ht' THEN 'Pa gen kontribisyon otomatik ki fèt. Tanpri voye yon to pou apwobasyon.'
                WHEN 'en' THEN 'No automatic contribution was made. Submit a rate for approval.'
                ELSE 'Aucune contribution automatique n’a été créée. Soumettez un taux à approbation.' END,
              '/modules/finance', 'emergency_funds', $2
       FROM users WHERE id = $1 AND is_active
       RETURNING id`,
      [recipientId, fund.id],
    );
    if (!notification.rowCount) {
      await client.query("DELETE FROM scheduled_notification_deliveries WHERE event_key = $1", [eventKey]);
      continue;
    }
    await client.query(
      "UPDATE scheduled_notification_deliveries SET notification_id = $2 WHERE event_key = $1",
      [eventKey, notification.rows[0].id],
    );
    created += 1;
  }
  return created;
}

export async function createAutomaticFundContribution(
  client: PoolClient,
  actorId: string,
  transaction: {
    id: string;
    entity_id: string;
    tx_type: string;
    tx_date: string;
    amount: string;
    currency: string;
    account_id: string;
    fx_rate_to_usd: string;
    reversal_of_id: string | null;
    account_transfer_id: string | null;
    source_table: string | null;
    source_id: string | null;
  },
) {
  if (transaction.tx_type !== "income" || transaction.reversal_of_id || transaction.account_transfer_id) return null;
  if (transaction.source_table === "fund_contributions") return null;

  const fundResult = await client.query<EmergencyFundRow>(
    `SELECT id, entity_id, account_id, currency, name, target_amount::text
     FROM emergency_funds
     WHERE entity_id = $1 AND is_active
     FOR UPDATE`,
    [transaction.entity_id],
  );
  if (!fundResult.rowCount) return null;
  const fund = fundResult.rows[0];
  if (!fund.account_id || fund.account_id === transaction.account_id) return null;
  if (transaction.source_table === "inter_entity_transfers" && transaction.source_id) {
    const excludedTransfer = await client.query<{ excluded: boolean }>(
      `SELECT reason IN ('capital_contribution', 'loan', 'loan_repayment') AS excluded
       FROM inter_entity_transfers WHERE id = $1`,
      [transaction.source_id],
    );
    if (excludedTransfer.rows[0]?.excluded) return null;
  }

  const rateResult = await client.query<{ id: string; percentage: string }>(
    `SELECT id, percentage::text
     FROM emergency_fund_rates
     WHERE fund_id = $1 AND approval_status = 'approved' AND effective_from <= $2::date
     ORDER BY effective_from DESC, created_at DESC
     LIMIT 1`,
    [fund.id, transaction.tx_date],
  );
  if (!rateResult.rowCount) {
    await warnFundApproversAboutMissingRate(client, fund, transaction.tx_date);
    return null;
  }

  const contributionBase = await client.query<{ amount: string }>(
    "SELECT round($1::numeric * $2::numeric / 100, 2)::text AS amount",
    [transaction.amount, rateResult.rows[0].percentage],
  );
  if (contributionBase.rows[0].amount === "0.00") return null;
  const amount = await convertFundCurrency(
    client,
    contributionBase.rows[0].amount,
    transaction.currency,
    fund.currency,
    transaction.tx_date,
  );
  if (amount === "0.00") return null;

  const accounts = await client.query<{
    id: string;
    account_type: string;
    cash_ceiling: string | null;
    cash_variance_tolerance: string | null;
  }>(
    `SELECT id, account_type, cash_ceiling::text, cash_variance_tolerance::text
     FROM accounts
     WHERE id = ANY($1::uuid[]) AND entity_id = $2 AND is_active
     ORDER BY id FOR UPDATE`,
    [[transaction.account_id, fund.account_id], fund.entity_id],
  );
  if (accounts.rowCount !== 2) throw new EmergencyFundError("The fund or source account is unavailable.", 409);

  const fundAccount = accounts.rows.find(({ id }) => id === fund.account_id)!;
  if (fundAccount.account_type === "cash") {
    if (!fundAccount.cash_ceiling || fundAccount.cash_variance_tolerance === null) {
      throw new EmergencyFundError("Configure the fund account cash controls before receiving contributions.", 409);
    }
    const session = await client.query<{ status: string }>(
      "SELECT status FROM cash_sessions WHERE account_id = $1 AND session_date = $2 FOR UPDATE",
      [fund.account_id, transaction.tx_date],
    );
    if (session.rows[0]?.status !== "open") {
      throw new EmergencyFundError("The fund cash session must be open to receive a contribution.", 409);
    }
    const ceiling = await client.query<{ exceeds: boolean }>(
      `SELECT balance + $2::numeric > $3::numeric AS exceeds
       FROM v_account_balances WHERE account_id = $1`,
      [fund.account_id, amount, fundAccount.cash_ceiling],
    );
    if (ceiling.rows[0]?.exceeds) {
      throw new EmergencyFundError("The contribution would exceed the fund account cash ceiling.", 409);
    }
  }

  const contributionResult = await client.query<{ id: string }>(
    `INSERT INTO fund_contributions(
       fund_id, source_tx_id, rate_id, base_amount, percentage_applied,
       amount, currency, contribution_date, kind, created_by
     )
     VALUES ($1, $2, $3, $4::numeric, $5::numeric, $6::numeric, $7, $8, 'automatic', $9)
     ON CONFLICT (source_tx_id, fund_id) DO NOTHING
     RETURNING id`,
    [
      fund.id,
      transaction.id,
      rateResult.rows[0].id,
      transaction.amount,
      rateResult.rows[0].percentage,
      amount,
      fund.currency,
      transaction.tx_date,
      actorId,
    ],
  );
  if (!contributionResult.rowCount) return null;
  const contributionId = contributionResult.rows[0].id;
  const fundFxRate = await historicalRateToUsd(client, fund.currency, transaction.tx_date);
  const outgoingNumber = await nextFundTransactionNumber(client, fund.entity_id, transaction.tx_date);
  const incomingNumber = await nextFundTransactionNumber(client, fund.entity_id, transaction.tx_date);
  const outgoing = await client.query<{ id: string }>(
    `INSERT INTO transactions(
       entity_id, tx_number, tx_type, tx_date, account_id, amount, currency, fx_rate_to_usd,
       description, status, created_by, validated_by, validated_at, source_table, source_id
     )
     VALUES ($1, $2, 'transfer_out', $3, $4, $5::numeric, $6, $7::numeric,
             $8, 'validated', $9, $9, now(), 'fund_contributions', $10)
     RETURNING id`,
    [
      fund.entity_id,
      outgoingNumber,
      transaction.tx_date,
      transaction.account_id,
      contributionBase.rows[0].amount,
      transaction.currency,
      transaction.fx_rate_to_usd,
      `Contribution au fonds d’urgence · ${transaction.id}`,
      actorId,
      contributionId,
    ],
  );
  const incoming = await client.query<{ id: string }>(
    `INSERT INTO transactions(
       entity_id, tx_number, tx_type, tx_date, account_id, amount, currency, fx_rate_to_usd,
       description, status, created_by, validated_by, validated_at, source_table, source_id
     )
     VALUES ($1, $2, 'transfer_in', $3, $4, $5::numeric, $6, $7::numeric,
             $8, 'validated', $9, $9, now(), 'fund_contributions', $10)
     RETURNING id`,
    [
      fund.entity_id,
      incomingNumber,
      transaction.tx_date,
      fund.account_id,
      amount,
      fund.currency,
      fundFxRate,
      `Contribution du revenu ${transaction.id}`,
      actorId,
      contributionId,
    ],
  );
  await client.query(
    `UPDATE fund_contributions SET outgoing_transaction_id = $2, transaction_id = $3 WHERE id = $1`,
    [contributionId, outgoing.rows[0].id, incoming.rows[0].id],
  );
  return { id: contributionId, amount, currency: fund.currency, sourceTransactionId: transaction.id };
}

export async function reverseFundAccounting(
  client: PoolClient,
  actorId: string,
  reversal: { id: string; reversal_of_id: string; tx_date: string },
) {
  const originalResult = await client.query<{
    tx_type: string;
    source_table: string | null;
    source_id: string | null;
  }>(
    "SELECT tx_type, source_table, source_id FROM transactions WHERE id = $1",
    [reversal.reversal_of_id],
  );
  if (!originalResult.rowCount) throw new EmergencyFundError("The original transaction is unavailable.", 409);
  const original = originalResult.rows[0];

  if (original.source_table === "fund_withdrawals" && original.source_id) {
    const result = await client.query(
      `UPDATE fund_withdrawals
       SET status = 'reversed', reversal_transaction_id = $2
       WHERE id = $1 AND transaction_id = $3 AND status = 'disbursed'
         AND reversal_transaction_id IS NULL`,
      [original.source_id, reversal.id, reversal.reversal_of_id],
    );
    if (!result.rowCount) throw new EmergencyFundError("The fund withdrawal could not be reversed.", 409);
    return;
  }

  if (original.tx_type !== "income") return;
  const contributionResult = await client.query<{
    id: string;
    fund_id: string;
    kind: "automatic" | "manual";
    amount: string;
    currency: string;
    outgoing_transaction_id: string | null;
    reversal_transaction_id: string | null;
  }>(
    `SELECT id, fund_id, kind, amount::text, currency, outgoing_transaction_id,
            reversal_transaction_id
     FROM fund_contributions
     WHERE source_tx_id = $1 OR transaction_id = $1
     FOR UPDATE`,
    [reversal.reversal_of_id],
  );
  if (!contributionResult.rowCount) return;
  const contribution = contributionResult.rows[0];
  if (contribution.reversal_transaction_id) {
    throw new EmergencyFundError("This fund contribution has already been reversed.", 409);
  }
  if (contribution.kind === "manual") {
    const result = await client.query(
      `UPDATE fund_contributions SET reversal_transaction_id = $2
       WHERE id = $1 AND reversal_transaction_id IS NULL`,
      [contribution.id, reversal.id],
    );
    if (!result.rowCount) throw new EmergencyFundError("The manual contribution could not be reversed.", 409);
    return;
  }
  if (!contribution.outgoing_transaction_id) {
    throw new EmergencyFundError("The contribution transfer history is incomplete.", 409);
  }

  const fundResult = await client.query<EmergencyFundRow>(
    `SELECT id, entity_id, account_id, currency, name, target_amount::text
     FROM emergency_funds WHERE id = $1 FOR UPDATE`,
    [contribution.fund_id],
  );
  const fund = fundResult.rows[0];
  if (!fund?.account_id) throw new EmergencyFundError("The emergency fund account is unavailable.", 409);
  const sourceResult = await client.query<{
    account_id: string;
    amount: string;
    currency: string;
  }>(
    `SELECT account_id, amount::text, currency
     FROM transactions WHERE id = $1 AND tx_type = 'transfer_out'`,
    [contribution.outgoing_transaction_id],
  );
  if (!sourceResult.rowCount) throw new EmergencyFundError("The contribution source transfer is unavailable.", 409);
  const sourceTransfer = sourceResult.rows[0];
  const accountIds = [fund.account_id, sourceTransfer.account_id].sort();
  const accounts = await client.query<{
    id: string;
    account_type: string;
    is_active: boolean;
    cash_ceiling: string | null;
    cash_variance_tolerance: string | null;
  }>(
    `SELECT id, account_type, is_active, cash_ceiling::text, cash_variance_tolerance::text
     FROM accounts WHERE id = ANY($1::uuid[]) AND entity_id = $2
     ORDER BY id FOR UPDATE`,
    [accountIds, fund.entity_id],
  );
  if (accounts.rowCount !== 2 || accounts.rows.some((account) => !account.is_active)) {
    throw new EmergencyFundError("The contribution accounts are unavailable.", 409);
  }

  const balance = await client.query<{ balance: string; reserved: string }>(
    `SELECT fund_balance.balance::text,
            COALESCE((
              SELECT SUM(withdrawal.amount)
              FROM fund_withdrawals withdrawal
              WHERE withdrawal.fund_id = fund.id AND withdrawal.status = 'approved'
            ), 0)::text AS reserved
     FROM v_fund_balance fund_balance
     JOIN emergency_funds fund ON fund.id = fund_balance.fund_id
     WHERE fund.id = $1`,
    [fund.id],
  );
  const enough = await client.query<{ enough: boolean }>(
    "SELECT $1::numeric - $2::numeric - $3::numeric >= 0 AS enough",
    [balance.rows[0]?.balance ?? "0", contribution.amount, balance.rows[0]?.reserved ?? "0"],
  );
  if (!enough.rows[0]?.enough) {
    throw new EmergencyFundError("The fund no longer has enough available balance to reverse this revenue.", 409);
  }

  for (const account of accounts.rows.filter((item) => item.account_type === "cash")) {
    if (!account.cash_ceiling || account.cash_variance_tolerance === null) {
      throw new EmergencyFundError("Configure cash controls before reversing this contribution.", 409);
    }
    const session = await client.query<{ status: string }>(
      "SELECT status FROM cash_sessions WHERE account_id = $1 AND session_date = $2 FOR UPDATE",
      [account.id, reversal.tx_date],
    );
    if (session.rows[0]?.status !== "open") {
      throw new EmergencyFundError("Open both relevant cash sessions before reversing this contribution.", 409);
    }
    if (account.id === sourceTransfer.account_id) {
      const ceiling = await client.query<{ exceeds: boolean }>(
        `SELECT balance + $2::numeric > $3::numeric AS exceeds
         FROM v_account_balances WHERE account_id = $1`,
        [account.id, sourceTransfer.amount, account.cash_ceiling],
      );
      if (ceiling.rows[0]?.exceeds) {
        throw new EmergencyFundError("The contribution reversal would exceed the source cash ceiling.", 409);
      }
    }
  }

  const fundRate = await historicalRateToUsd(client, fund.currency, reversal.tx_date);
  const sourceRate = await historicalRateToUsd(client, sourceTransfer.currency, reversal.tx_date);
  const outgoingNumber = await nextFundTransactionNumber(client, fund.entity_id, reversal.tx_date);
  const incomingNumber = await nextFundTransactionNumber(client, fund.entity_id, reversal.tx_date);
  const outgoing = await client.query<{ id: string }>(
    `INSERT INTO transactions(
       entity_id, tx_number, tx_type, tx_date, account_id, amount, currency, fx_rate_to_usd,
       description, status, created_by, validated_by, validated_at, source_table, source_id
     )
     VALUES ($1, $2, 'transfer_out', $3, $4, $5::numeric, $6, $7::numeric,
             $8, 'validated', $9, $9, now(), 'fund_contributions', $10)
     RETURNING id`,
    [
      fund.entity_id,
      outgoingNumber,
      reversal.tx_date,
      fund.account_id,
      contribution.amount,
      fund.currency,
      fundRate,
      `Contre-passation de contribution · ${reversal.reversal_of_id}`,
      actorId,
      contribution.id,
    ],
  );
  const incoming = await client.query<{ id: string }>(
    `INSERT INTO transactions(
       entity_id, tx_number, tx_type, tx_date, account_id, amount, currency, fx_rate_to_usd,
       description, status, created_by, validated_by, validated_at, source_table, source_id
     )
     VALUES ($1, $2, 'transfer_in', $3, $4, $5::numeric, $6, $7::numeric,
             $8, 'validated', $9, $9, now(), 'fund_contributions', $10)
     RETURNING id`,
    [
      fund.entity_id,
      incomingNumber,
      reversal.tx_date,
      sourceTransfer.account_id,
      sourceTransfer.amount,
      sourceTransfer.currency,
      sourceRate,
      `Retour de contribution · ${reversal.reversal_of_id}`,
      actorId,
      contribution.id,
    ],
  );
  const update = await client.query(
    `UPDATE fund_contributions
     SET reversal_transaction_id = $2, reversal_incoming_transaction_id = $3
     WHERE id = $1 AND reversal_transaction_id IS NULL`,
    [contribution.id, outgoing.rows[0].id, incoming.rows[0].id],
  );
  if (!update.rowCount) throw new EmergencyFundError("The automatic contribution could not be reversed.", 409);
}
