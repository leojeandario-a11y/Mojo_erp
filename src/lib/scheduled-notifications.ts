import "server-only";
import type { PoolClient } from "pg";
import { getPool, withDbUser } from "@/lib/db";
import { processNotificationPushQueue } from "@/lib/web-push";

type ScheduledKind =
  | "invoice_overdue"
  | "payment_expected"
  | "contract_expiring"
  | "budget_exceeded"
  | "project_late"
  | "monthly_report"
  | "fund_target_reached";

interface ScheduledCandidate {
  kind: ScheduledKind;
  ref_table: string;
  ref_id: string;
  recipient_id: string;
  reference: string;
  event_date: string | null;
}

interface ReminderCopy {
  title: { fr: string; ht: string; en: string };
  body: (reference: string, eventDate: string | null) => { fr: string; ht: string; en: string };
  link: string;
}

const reminderCopy: Record<ScheduledKind, ReminderCopy> = {
  invoice_overdue: {
    title: { fr: "Facture en retard", ht: "Fakti anreta", en: "Overdue invoice" },
    body: (reference) => ({
      fr: `La facture ${reference} est en retard et présente encore un solde à payer.`,
      ht: `Fakti ${reference} anreta epi li toujou gen yon montan pou peye.`,
      en: `Invoice ${reference} is overdue and still has an outstanding balance.`,
    }),
    link: "/modules/business",
  },
  payment_expected: {
    title: { fr: "Paiement attendu", ht: "Peman ki prevwa", en: "Payment expected" },
    body: (reference, eventDate) => ({
      fr: `Le paiement de la facture ${reference} est attendu le ${eventDate}.`,
      ht: `Peman pou fakti ${reference} prevwa pou ${eventDate}.`,
      en: `Payment for invoice ${reference} is expected on ${eventDate}.`,
    }),
    link: "/modules/business",
  },
  contract_expiring: {
    title: { fr: "Contrat arrivant à échéance", ht: "Kontra k ap rive nan dat", en: "Contract expiring" },
    body: (reference, eventDate) => ({
      fr: `Le contrat ${reference} arrive à échéance le ${eventDate}.`,
      ht: `Kontra ${reference} ap rive nan dat li ${eventDate}.`,
      en: `Contract ${reference} expires on ${eventDate}.`,
    }),
    link: "/modules/business",
  },
  budget_exceeded: {
    title: { fr: "Seuil budgétaire dépassé", ht: "Papòt bidjè a depase", en: "Budget threshold reached" },
    body: (reference) => ({
      fr: `Le budget « ${reference} » a atteint ou dépassé son seuil d’alerte configuré.`,
      ht: `Bidjè « ${reference} » rive oswa depase papòt alèt ki te fikse a.`,
      en: `Budget “${reference}” has reached or exceeded its configured alert threshold.`,
    }),
    link: "/modules/finance",
  },
  project_late: {
    title: { fr: "Projet en retard", ht: "Pwojè anreta", en: "Project overdue" },
    body: (reference, eventDate) => ({
      fr: `Le projet « ${reference} » a dépassé sa date de fin prévue (${eventDate}).`,
      ht: `Pwojè « ${reference} » depase dat fen li te prevwa a (${eventDate}).`,
      en: `Project “${reference}” is past its planned end date (${eventDate}).`,
    }),
    link: "/modules/projects",
  },
  monthly_report: {
    title: { fr: "Rapport mensuel du fonds", ht: "Rapò mansyèl fon an", en: "Monthly fund report" },
    body: (reference) => ({
      fr: `Le rapport du fonds d’urgence pour ${reference} est disponible dans Finance.`,
      ht: `Rapò fon ijans lan pou ${reference} disponib nan Finans.`,
      en: `The emergency fund report for ${reference} is available in Finance.`,
    }),
    link: "/modules/finance",
  },
  fund_target_reached: {
    title: { fr: "Objectif du fonds atteint", ht: "Objektif fon an rive", en: "Fund target reached" },
    body: (reference) => ({
      fr: `Le fonds d’urgence a atteint son objectif configuré (${reference}).`,
      ht: `Fon ijans lan rive nan objektif li (${reference}).`,
      en: `The emergency fund has reached its configured target (${reference}).`,
    }),
    link: "/modules/finance",
  },
};

async function findCandidates(client: PoolClient, reminderWindowDays: number) {
  const result = await client.query<ScheduledCandidate>(
    `SELECT 'invoice_overdue'::text AS kind, 'invoices'::text AS ref_table,
            invoice.id AS ref_id, COALESCE(customer.owner_id, invoice.created_by) AS recipient_id,
            invoice.invoice_number AS reference, invoice.due_date::text AS event_date
     FROM invoices invoice
     JOIN v_invoice_balances balance ON balance.invoice_id = invoice.id
     JOIN customers customer ON customer.id = invoice.customer_id
     WHERE invoice.status IN ('issued', 'partially_paid', 'overdue')
       AND invoice.due_date < CURRENT_DATE AND balance.balance_due > 0
       AND COALESCE(customer.owner_id, invoice.created_by) IS NOT NULL
     UNION ALL
     SELECT 'payment_expected', 'invoices', invoice.id,
            COALESCE(customer.owner_id, invoice.created_by),
            invoice.invoice_number, invoice.due_date::text
     FROM invoices invoice
     JOIN v_invoice_balances balance ON balance.invoice_id = invoice.id
     JOIN customers customer ON customer.id = invoice.customer_id
     WHERE invoice.status IN ('issued', 'partially_paid')
       AND invoice.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + $1::int
       AND balance.balance_due > 0
       AND COALESCE(customer.owner_id, invoice.created_by) IS NOT NULL
     UNION ALL
     SELECT 'contract_expiring', 'contracts', contract.id,
            COALESCE(opportunity.owner_id, customer.owner_id),
            contract.contract_number, contract.end_date::text
     FROM contracts contract
     LEFT JOIN opportunities opportunity ON opportunity.id = contract.opportunity_id
     LEFT JOIN customers customer ON customer.id = contract.customer_id
     WHERE contract.status = 'active'
       AND contract.end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + $1::int
       AND COALESCE(opportunity.owner_id, customer.owner_id) IS NOT NULL
     UNION ALL
     SELECT 'budget_exceeded', 'budgets', budget.id, budget.created_by, budget.name, NULL
     FROM budgets budget
     LEFT JOIN LATERAL (
       SELECT SUM(
                (CASE
                  WHEN tx.tx_type = 'income' AND source_original.tx_type = 'expense' THEN -1
                  WHEN tx.tx_type = 'adjustment'
                    AND tx.adjustment_direction = 'increase'
                    AND source_original.tx_type = 'adjustment'
                    AND source_original.adjustment_direction = 'decrease' THEN -1
                  ELSE 1
                END) * CASE
                  WHEN budget.currency = 'USD' THEN tx.amount_usd
                  WHEN tx.currency = budget.currency THEN tx.amount
                  WHEN budget.currency = 'HTG' AND tx.currency = 'USD' AND fx.htg_per_usd IS NOT NULL
                    THEN ROUND(tx.amount_usd * fx.htg_per_usd, 2)
                END
              ) AS actual_amount,
              COUNT(*) FILTER (
                WHERE budget.currency = 'HTG' AND tx.currency = 'USD' AND fx.htg_per_usd IS NULL
              ) AS missing_rate_count
       FROM transactions tx
       LEFT JOIN transactions source_original ON source_original.id = tx.reversal_of_id
       LEFT JOIN LATERAL (
         SELECT CASE WHEN rate.from_currency = 'USD' THEN rate.rate ELSE 1 / rate.rate END AS htg_per_usd
         FROM exchange_rates rate
         WHERE rate.rate_date <= tx.tx_date
           AND ((rate.from_currency = 'USD' AND rate.to_currency = 'HTG')
             OR (rate.from_currency = 'HTG' AND rate.to_currency = 'USD'))
         ORDER BY rate.rate_date DESC, (rate.from_currency = 'USD') DESC, rate.created_at DESC
         LIMIT 1
       ) fx ON true
       WHERE tx.entity_id = budget.entity_id
         AND (
           tx.tx_type = 'expense'
           OR (tx.tx_type = 'adjustment' AND tx.adjustment_direction = 'decrease')
           OR (tx.tx_type = 'income' AND source_original.tx_type = 'expense')
           OR (tx.tx_type = 'adjustment' AND tx.adjustment_direction = 'increase'
             AND source_original.tx_type = 'adjustment' AND source_original.adjustment_direction = 'decrease')
         )
         AND tx.status IN ('validated', 'reversed')
         AND tx.tx_date >= CASE
           WHEN budget.period_type = 'annual' THEN make_date(budget.fiscal_year, 1, 1)
           ELSE make_date(budget.fiscal_year, budget.period_month, 1)
         END
         AND tx.tx_date < CASE
           WHEN budget.period_type = 'annual' THEN make_date(budget.fiscal_year + 1, 1, 1)
           ELSE (make_date(budget.fiscal_year, budget.period_month, 1) + INTERVAL '1 month')::date
         END
         AND (budget.scope <> 'department' OR COALESCE(tx.department_id, source_original.department_id) = budget.department_id)
         AND (budget.scope <> 'project' OR COALESCE(tx.project_id, source_original.project_id) = budget.project_id)
         AND (budget.scope <> 'category' OR EXISTS (
           SELECT 1 FROM budget_lines line
           WHERE line.budget_id = budget.id
             AND line.category_id = COALESCE(tx.category_id, source_original.category_id)
         ))
         AND (budget.scope <> 'marketing' OR COALESCE(tx.department_id, source_original.department_id) = (
           SELECT id FROM departments WHERE code = 'MKT'
         ))
         AND (budget.scope <> 'operations' OR COALESCE(tx.department_id, source_original.department_id) = (
           SELECT id FROM departments WHERE code = 'OPS'
         ))
         AND (budget.scope <> 'hr' OR COALESCE(tx.department_id, source_original.department_id) = (
           SELECT id FROM departments WHERE code = 'DRH'
         ))
     ) actual ON true
     WHERE budget.status = 'approved'
       AND budget.created_by IS NOT NULL
       AND CURRENT_DATE >= CASE
         WHEN budget.period_type = 'annual' THEN make_date(budget.fiscal_year, 1, 1)
         ELSE make_date(budget.fiscal_year, budget.period_month, 1)
       END
       AND CURRENT_DATE < CASE
         WHEN budget.period_type = 'annual' THEN make_date(budget.fiscal_year + 1, 1, 1)
         ELSE (make_date(budget.fiscal_year, budget.period_month, 1) + INTERVAL '1 month')::date
       END
       AND COALESCE(actual.missing_rate_count, 0) = 0
       AND COALESCE(actual.actual_amount, 0) >= (
         SELECT COALESCE(SUM(line.planned_amount), 0)
         FROM budget_lines line WHERE line.budget_id = budget.id
       ) * budget.alert_threshold_pct / 100
       AND (
         SELECT COALESCE(SUM(line.planned_amount), 0)
         FROM budget_lines line WHERE line.budget_id = budget.id
       ) > 0
     UNION ALL
     SELECT 'project_late', 'projects', project.id,
            COALESCE(project.manager_id, member.user_id),
            project.name, project.end_date::text
     FROM projects project
     LEFT JOIN project_members member
       ON member.project_id = project.id AND project.manager_id IS NULL
     WHERE project.status = 'in_progress'
       AND project.end_date < CURRENT_DATE
       AND COALESCE(project.manager_id, member.user_id) IS NOT NULL
     UNION ALL
     SELECT 'monthly_report', 'emergency_funds', fund.id, fund_reader.user_id,
            to_char(date_trunc('month', CURRENT_DATE) - INTERVAL '1 month', 'YYYY-MM'),
            (date_trunc('month', CURRENT_DATE) - INTERVAL '1 day')::date::text
     FROM emergency_funds fund
     JOIN LATERAL (
       SELECT DISTINCT user_role.user_id
       FROM user_roles user_role
       JOIN role_permissions role_permission ON role_permission.role_id = user_role.role_id
       JOIN permissions permission ON permission.id = role_permission.permission_id
       WHERE permission.code IN ('finance.fund.read', '*')
         AND (user_role.entity_id IS NULL OR user_role.entity_id = fund.entity_id)
     ) fund_reader ON true
     WHERE fund.is_active
     UNION ALL
     SELECT 'fund_target_reached', 'emergency_funds', fund.id, fund_reader.user_id,
            fund.name || ' · ' || fund.target_amount::text || ' ' || fund.currency,
            fund.target_amount::text
     FROM emergency_funds fund
     JOIN v_fund_balance balance ON balance.fund_id = fund.id
     JOIN LATERAL (
       SELECT DISTINCT user_role.user_id
       FROM user_roles user_role
       JOIN role_permissions role_permission ON role_permission.role_id = user_role.role_id
       JOIN permissions permission ON permission.id = role_permission.permission_id
       WHERE permission.code IN ('finance.fund.read', '*')
         AND (user_role.entity_id IS NULL OR user_role.entity_id = fund.entity_id)
     ) fund_reader ON true
     WHERE fund.is_active AND fund.target_amount IS NOT NULL
       AND balance.balance >= fund.target_amount`,
    [reminderWindowDays],
  );
  return result.rows;
}

function reminderWindowDays() {
  const raw = process.env.MOJO_SCHEDULED_REMINDER_WINDOW_DAYS;
  if (!raw) return 7;
  if (!/^\d{1,2}$/.test(raw)) throw new Error("MOJO_SCHEDULED_REMINDER_WINDOW_DAYS must be an integer from 0 to 30.");
  const value = Number(raw);
  if (value > 30) throw new Error("MOJO_SCHEDULED_REMINDER_WINDOW_DAYS must be an integer from 0 to 30.");
  return value;
}

export async function runScheduledNotifications() {
  const client = await getPool().connect();
  let candidates: ScheduledCandidate[];
  try {
    candidates = await findCandidates(client, reminderWindowDays());
  } finally {
    client.release();
  }

  const counts: Record<ScheduledKind, number> = {
    invoice_overdue: 0,
    payment_expected: 0,
    contract_expiring: 0,
    budget_exceeded: 0,
    project_late: 0,
    monthly_report: 0,
    fund_target_reached: 0,
  };
  let created = 0;
  for (const candidate of candidates) {
    const copy = reminderCopy[candidate.kind];
    const body = copy.body(candidate.reference, candidate.event_date);
    const eventKey = [
      candidate.kind,
      candidate.ref_table,
      candidate.ref_id,
      candidate.event_date ?? "threshold",
      candidate.recipient_id,
    ].join(":");
    const wasCreated = await withDbUser(candidate.recipient_id, null, async (recipientClient) => {
      const delivery = await recipientClient.query<{ event_key: string }>(
        `INSERT INTO scheduled_notification_deliveries(event_key, recipient_id)
         VALUES ($1, $2)
         ON CONFLICT (event_key) DO NOTHING
         RETURNING event_key`,
        [eventKey, candidate.recipient_id],
      );
      if (!delivery.rowCount) return false;
      const notification = await recipientClient.query<{ id: string }>(
        `INSERT INTO notifications(user_id, kind, title, body, link, ref_table, ref_id)
         SELECT u.id, $2,
                CASE u.locale WHEN 'ht' THEN $4 WHEN 'en' THEN $5 ELSE $3 END,
                CASE u.locale WHEN 'ht' THEN $7 WHEN 'en' THEN $8 ELSE $6 END,
                $9, $10, $11
         FROM users u WHERE u.id = $1 AND u.is_active
         RETURNING id`,
        [
          candidate.recipient_id,
          candidate.kind,
          copy.title.fr,
          copy.title.ht,
          copy.title.en,
          body.fr,
          body.ht,
          body.en,
          copy.link,
          candidate.ref_table,
          candidate.ref_id,
        ],
      );
      if (!notification.rowCount) {
        await recipientClient.query(
          "DELETE FROM scheduled_notification_deliveries WHERE event_key = $1",
          [eventKey],
        );
        return false;
      }
      await recipientClient.query(
        "UPDATE scheduled_notification_deliveries SET notification_id = $2 WHERE event_key = $1",
        [eventKey, notification.rows[0].id],
      );
      return true;
    });
    if (wasCreated) {
      created += 1;
      counts[candidate.kind] += 1;
    }
  }

  const push = await processNotificationPushQueue();
  return { candidates: candidates.length, created, counts, push };
}
