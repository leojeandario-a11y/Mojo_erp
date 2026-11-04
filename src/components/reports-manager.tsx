"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import type { Locale } from "@/lib/auth";
import type { ReportCategory } from "@/lib/reports";
import { buildXlsx } from "@/lib/reports-export.mjs";

type CatalogItem = { category: ReportCategory; entities: { id: string; name: string }[] };
type ReportRow = Record<string, string | null>;
type ReportSchedule = {
  id: string;
  category: ReportCategory;
  frequency: "daily" | "weekly" | "monthly";
  entity_id: string | null;
  entity_name: string | null;
  window_days: number;
  next_run_at: string;
  last_run_at: string | null;
};
type ReportData = {
  category: ReportCategory;
  from: string;
  to: string;
  rows: ReportRow[];
  financialSummary?: ReportRow[];
  rowCount: number;
  truncated: boolean;
  generatedAt: string;
};

const categories: ReportCategory[] = ["finance", "hr", "business", "marketing", "operations", "store"];

async function fetchReportData(
  selectedCategory: ReportCategory,
  start: string,
  end: string,
  selectedEntity: string,
  errorMessage: string,
): Promise<ReportData> {
  const params = new URLSearchParams({ category: selectedCategory, from: start, to: end });
  if (selectedEntity) params.set("entityId", selectedEntity);
  const response = await fetch(`/api/v1/reports?${params}`, { cache: "no-store" });
  const body = await response.json() as ReportData & { error?: string };
  if (!response.ok) throw new Error(body.error || errorMessage);
  return body;
}

const text = {
  fr: {
    eyebrow: "PILOTAGE · ANALYTIQUE", title: "Centre de rapports", intro: "Des rapports consolidés, filtrés selon vos autorisations et vos périmètres d’entité.",
    category: "Domaine", from: "Du", to: "Au", entity: "Entité", allEntities: "Toutes les entités autorisées", organization: "MoJoPIKtures",
    apply: "Actualiser le rapport", excel: "Exporter Excel", pdf: "Imprimer / PDF", loading: "Chargement…",
    select: "Sélectionnez un domaine pour afficher le rapport.", noRows: "Aucune donnée pour cette période et ce périmètre.",
    rows: "lignes", generated: "Généré le", truncated: "Aperçu limité aux 1 000 premières lignes. Affinez la période ou l’entité pour obtenir un export complet.",
    scheduleTitle: "Planifier un rapport", scheduleDescription: "Recevez un rappel dans le centre de notifications pour consulter et exporter ce rapport.",
    frequency: "Fréquence", daily: "Chaque jour", weekly: "Chaque semaine", monthly: "Chaque mois",
    window: "Période glissante", days7: "7 derniers jours", days30: "30 derniers jours", days90: "90 derniers jours", days365: "365 derniers jours",
    createSchedule: "Ajouter la planification", schedules: "Vos planifications", noSchedules: "Aucune planification active.",
    nextRun: "Prochaine exécution", removeSchedule: "Supprimer", scheduling: "Enregistrement…",
    scheduleMissing: "La planification nécessite la migration de base de données 034, à appliquer avec un compte propriétaire.",
    scheduleNote: "Les rappels sont envoyés dans l’application à 08:00 UTC. Configurez la tâche planifiée Windows décrite dans le README. Aucun fichier PDF ou courriel n’est envoyé automatiquement.",
    financialSummaryTitle: "Synthèse financière",
    financialSummaryNote: "Résultat sur la période; trésorerie, fonds, budgets, créances et dettes à la date de fin. Les montants restent dans leur devise d’origine. Les lignes visibles respectent les droits du rôle.",
    financialMetrics: {
      result: "Résultat et rentabilité", treasury: "Trésorerie", emergency_fund: "Fonds d’urgence",
      budget: "Budget approuvé actif", receivable: "Créances clients", debt: "Dettes",
    },
    finance: "Finance", hr: "Ressources humaines", business: "Affaires", marketing: "Marketing", operations: "Opérations", store: "MOJO Store",
    descriptions: {
      finance: "Évolution mensuelle et synthèse des indicateurs financiers consolidés.",
      hr: "Présences mensuelles agrégées par entité et direction. Aucune donnée salariale ni identité personnelle.",
      business: "Pipeline d’opportunités par étape et devise. Les montants ne sont pas additionnés entre devises.",
      marketing: "Campagnes, budgets prévus dans leur devise d’origine et dépenses validées en USD, si votre rôle Finance les autorise.",
      operations: "Portefeuille de projets, progression et budgets. Les coûts réels en USD ne sont visibles qu’avec les droits Finance.",
      store: "Ventes et remboursements validés, regroupés par mois de comptabilisation et réconciliés au grand livre Store.",
    },
    columns: {
      period: "Période", entity: "Entité", department: "Direction", income_usd: "Revenus USD", expense_usd: "Dépenses USD", net_usd: "Net USD",
      transactions: "Transactions", present: "Présents", absent: "Absents", late: "En retard", permission: "Permissions", remote: "À distance",
      stage: "Étape", currency: "Devise", opportunities: "Opportunités", estimated: "Estimé", campaign: "Campagne", status: "Statut",
      budget: "Budget prévu", spent_usd: "Dépenses USD", project: "Projet", progress_pct: "Progression %",
      expenses_usd: "Coûts USD", receipts: "Ventes", gross_sales_usd: "Ventes brutes USD", returned_sales_usd: "Retours USD", net_sales_usd: "Ventes nettes USD",
      metric: "Indicateur", subject: "Élément", balance: "Solde", target_amount: "Objectif", planned_amount: "Prévu",
      actual_amount: "Réalisé", net_margin_pct: "Marge nette %", missing_rate_count: "Taux manquant",
    },
    errors: { catalog: "Impossible de charger le catalogue de rapports.", report: "Impossible de charger ce rapport.", export: "Impossible de créer le fichier Excel." },
  },
  ht: {
    eyebrow: "JESYON · ANALIZ", title: "Sant rapò", intro: "Rapò konsolide ki respekte otorizasyon ak limit antite ou.",
    category: "Domen", from: "Soti", to: "Jiska", entity: "Antite", allEntities: "Tout antite ou gen dwa wè", organization: "MoJoPIKtures",
    apply: "Mete rapò a ajou", excel: "Ekspòte Excel", pdf: "Enprime / PDF", loading: "Ap chaje…",
    select: "Chwazi yon domèn pou wè rapò a.", noRows: "Pa gen done pou peryòd ak limit sa a.",
    rows: "liy", generated: "Kreye nan", truncated: "Se 1 000 premye liy yo sèlman ki parèt. Redui peryòd la oswa chwazi yon antite pou ekspòtasyon konplè.",
    scheduleTitle: "Pwograme yon rapò", scheduleDescription: "Resevwa yon rapèl nan sant notifikasyon an pou konsilte epi ekspòte rapò sa a.",
    frequency: "Frekans", daily: "Chak jou", weekly: "Chak semèn", monthly: "Chak mwa",
    window: "Peryòd woulan", days7: "7 dènye jou yo", days30: "30 dènye jou yo", days90: "90 dènye jou yo", days365: "365 dènye jou yo",
    createSchedule: "Ajoute pwogramasyon", schedules: "Pwogramasyon ou yo", noSchedules: "Pa gen pwogramasyon aktif.",
    nextRun: "Pwochen egzekisyon", removeSchedule: "Retire", scheduling: "Ap anrejistre…",
    scheduleMissing: "Planifikasyon an bezwen migrasyon baz done 034 la; se yon pwopriyetè baz done ki dwe aplike li.",
    scheduleNote: "Rapèl yo parèt nan aplikasyon an a 08:00 UTC. Konfigire travay Windows ki dekri nan README la. Pa gen PDF oswa imèl ki voye otomatikman.",
    financialSummaryTitle: "Rezime finansye",
    financialSummaryNote: "Rezilta pou peryòd la; lajan kach, fon, bidjè, lajan kliyan dwe ak dèt nan dat fen a. Montan yo rete nan lajan orijinal yo. Wòl ou a detèmine ki liy ki parèt.",
    financialMetrics: {
      result: "Rezilta ak rentabilite", treasury: "Lajan kach", emergency_fund: "Fon ijans",
      budget: "Bidjè apwouve aktif", receivable: "Lajan kliyan dwe", debt: "Dèt",
    },
    finance: "Finans", hr: "Resous imèn", business: "Biznis", marketing: "Maketing", operations: "Operasyon", store: "MOJO Store",
    descriptions: {
      finance: "Revni, depans ak ajisteman pa mwa, ansanm ak rezime endikatè finansye yo.",
      hr: "Prezans chak mwa pa antite ak direksyon. Pa gen done sou salè ni idantite moun.",
      business: "Opòtinite pa etap ak lajan. Montan diferan lajan pa melanje.",
      marketing: "Kanpay, bidjè nan lajan orijinal la ak depans valide an USD si w gen dwa Finans.",
      operations: "Pwojè, pwogrè ak bidjè. Depans reyèl an USD parèt sèlman si w gen dwa Finans.",
      store: "Vant ak ranbousman ki valide, klase pa mwa kontab epi rekonsilye ak gwo liv Store la.",
    },
    columns: {
      period: "Peryòd", entity: "Antite", department: "Direksyon", income_usd: "Revni USD", expense_usd: "Depans USD", net_usd: "Net USD",
      transactions: "Tranzaksyon", present: "Prezan", absent: "Absan", late: "Anreta", permission: "Pèmisyon", remote: "Adistans",
      stage: "Etap", currency: "Lajan", opportunities: "Opòtinite", estimated: "Estimasyon", campaign: "Kanpay", status: "Estati",
      budget: "Bidjè prevwa", spent_usd: "Depans USD", project: "Pwojè", progress_pct: "Pwogrè %",
      expenses_usd: "Depans USD", receipts: "Vant", gross_sales_usd: "Vant brit USD", returned_sales_usd: "Retou USD", net_sales_usd: "Vant nèt USD",
      metric: "Endikatè", subject: "Eleman", balance: "Balans", target_amount: "Objektif", planned_amount: "Prevwa",
      actual_amount: "Reyalize", net_margin_pct: "Marge nèt %", missing_rate_count: "Pousantaj ki manke",
    },
    errors: { catalog: "Pa kapab chaje lis rapò yo.", report: "Pa kapab chaje rapò sa a.", export: "Pa kapab kreye fichye Excel la." },
  },
  en: {
    eyebrow: "BUSINESS INTELLIGENCE · ANALYTICS", title: "Reporting center", intro: "Consolidated reports scoped to your entity access and permissions.",
    category: "Domain", from: "From", to: "To", entity: "Entity", allEntities: "All entities you can access", organization: "MoJoPIKtures",
    apply: "Refresh report", excel: "Export Excel", pdf: "Print / PDF", loading: "Loading…",
    select: "Choose a domain to view its report.", noRows: "No data for this period and scope.",
    rows: "rows", generated: "Generated", truncated: "Showing the first 1,000 rows only. Narrow the date range or entity to export the complete result.",
    scheduleTitle: "Schedule a report", scheduleDescription: "Receive an in-app notification reminder to review and export this report.",
    frequency: "Frequency", daily: "Daily", weekly: "Weekly", monthly: "Monthly",
    window: "Rolling period", days7: "Last 7 days", days30: "Last 30 days", days90: "Last 90 days", days365: "Last 365 days",
    createSchedule: "Add schedule", schedules: "Your schedules", noSchedules: "No active schedules.",
    nextRun: "Next run", removeSchedule: "Remove", scheduling: "Saving…",
    scheduleMissing: "Scheduling requires database migration 034, applied with a database-owner account.",
    scheduleNote: "Reminders appear in-app at 08:00 UTC. Configure the Windows scheduled task described in README. PDF files and emails are not sent automatically.",
    financialSummaryTitle: "Financial summary",
    financialSummaryNote: "Period result; treasury, funds, budgets, receivables, and debts as of the end date. Amounts remain in their native currencies. Visible rows follow the current role’s permissions.",
    financialMetrics: {
      result: "Result and profitability", treasury: "Treasury", emergency_fund: "Emergency fund",
      budget: "Active approved budget", receivable: "Accounts receivable", debt: "Debt",
    },
    finance: "Finance", hr: "Human resources", business: "Commercial", marketing: "Marketing", operations: "Operations", store: "MOJO Store",
    descriptions: {
      finance: "Monthly activity and consolidated financial indicators.",
      hr: "Monthly attendance totals by entity and department. No salary or personal identity data.",
      business: "Opportunity pipeline by stage and currency. Amounts are not added across currencies.",
      marketing: "Campaigns, planned budgets in their original currency, and validated USD spend where Finance access allows.",
      operations: "Project portfolio, progress, and budgets. Actual costs in USD require Finance access.",
      store: "Validated sales and refunds grouped by posting month and reconciled to the Store ledger.",
    },
    columns: {
      period: "Period", entity: "Entity", department: "Department", income_usd: "Income USD", expense_usd: "Expenses USD", net_usd: "Net USD",
      transactions: "Transactions", present: "Present", absent: "Absent", late: "Late", permission: "Permission", remote: "Remote",
      stage: "Stage", currency: "Currency", opportunities: "Opportunities", estimated: "Estimated", campaign: "Campaign", status: "Status",
      budget: "Planned budget", spent_usd: "Spend USD", project: "Project", progress_pct: "Progress %",
      expenses_usd: "Costs USD", receipts: "Sales", gross_sales_usd: "Gross sales USD", returned_sales_usd: "Returns USD", net_sales_usd: "Net sales USD",
      metric: "Metric", subject: "Item", balance: "Balance", target_amount: "Target", planned_amount: "Planned",
      actual_amount: "Actual", net_margin_pct: "Net margin %", missing_rate_count: "Missing rate",
    },
    errors: { catalog: "Unable to load the report catalog.", report: "Unable to load this report.", export: "Unable to create the Excel file." },
  },
} as const;

const reportColumns: Record<ReportCategory, string[]> = {
  finance: ["period", "entity", "department", "income_usd", "expense_usd", "net_usd", "transactions"],
  hr: ["period", "entity", "department", "present", "absent", "late", "permission", "remote"],
  business: ["period", "entity", "stage", "currency", "opportunities", "estimated"],
  marketing: ["campaign", "entity", "department", "status", "period", "budget", "currency", "spent_usd"],
  operations: ["project", "entity", "department", "status", "progress_pct", "budget", "currency", "expenses_usd"],
  store: ["period", "receipts", "gross_sales_usd", "returned_sales_usd", "net_sales_usd"],
};

const financialSummaryColumns = [
  "entity", "metric", "subject", "currency", "balance", "target_amount", "planned_amount",
  "actual_amount", "income_usd", "expense_usd", "net_usd", "net_margin_pct", "missing_rate_count",
];

function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function ReportsManager({ locale }: { locale: Locale }) {
  const copy = text[locale];
  const dateLocale = locale === "ht" ? "ht-HT" : locale === "en" ? "en-US" : "fr-FR";
  const formatDate = (value: string, withTime = false) => new Intl.DateTimeFormat(dateLocale, withTime
    ? { dateStyle: "medium", timeStyle: "short" }
    : { dateStyle: "long", timeZone: "UTC" }).format(new Date(value));
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [category, setCategory] = useState<ReportCategory | "">("");
  const [entityId, setEntityId] = useState("");
  const [from, setFrom] = useState(() => {
    const date = new Date();
    date.setMonth(date.getMonth() - 11, 1);
    return localDate(date);
  });
  const [to, setTo] = useState(() => localDate(new Date()));
  const [report, setReport] = useState<ReportData | null>(null);
  const [schedules, setSchedules] = useState<ReportSchedule[]>([]);
  const [scheduleError, setScheduleError] = useState("");
  const [scheduleAvailable, setScheduleAvailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [removingSchedule, setRemovingSchedule] = useState("");
  const [frequency, setFrequency] = useState<ReportSchedule["frequency"]>("weekly");
  const [windowDays, setWindowDays] = useState<7 | 30 | 90 | 365>(30);
  const [error, setError] = useState("");

  const selectedCatalog = catalog.find((item) => item.category === category);
  const columns = category ? reportColumns[category] : [];
  const monthTrend = useMemo(() => {
    if (category !== "finance" || !report) return [];
    const months = new Map<string, { income: number; expense: number }>();
    for (const row of report.rows) {
      const month = String(row.period ?? "");
      const totals = months.get(month) ?? { income: 0, expense: 0 };
      totals.income += Number(row.income_usd ?? 0);
      totals.expense += Number(row.expense_usd ?? 0);
      months.set(month, totals);
    }
    return [...months.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [category, report]);

  useEffect(() => {
    let active = true;
    fetch("/api/v1/reports", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as { categories?: CatalogItem[]; error?: string };
        if (!response.ok) throw new Error(body.error || copy.errors.catalog);
        if (!active) return;
        const permitted = body.categories ?? [];
        setCatalog(permitted);
        const query = new URLSearchParams(window.location.search);
        const requestedCategory = query.get("category") as ReportCategory | null;
        const requestedItem = permitted.find((item) => item.category === requestedCategory);
        const selected = requestedItem ?? permitted[0];
        setCategory(selected?.category ?? "");
        const requestedFrom = query.get("from");
        const requestedTo = query.get("to");
        if (requestedFrom && /^\d{4}-\d{2}-\d{2}$/.test(requestedFrom)) setFrom(requestedFrom);
        if (requestedTo && /^\d{4}-\d{2}-\d{2}$/.test(requestedTo)) setTo(requestedTo);
        const requestedEntity = query.get("entityId");
        if (requestedEntity && selected?.entities.some((entity) => entity.id === requestedEntity)) {
          setEntityId(requestedEntity);
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : copy.errors.catalog);
      });
    return () => { active = false; };
  }, [copy.errors.catalog]);

  useEffect(() => {
    if (!category || !catalog.some((item) => item.category === category)) return;
    void loadReport(category, from, to, entityId);
  }, [category, catalog]);

  useEffect(() => {
    let active = true;
    fetch("/api/v1/reports/schedules", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as { schedules?: ReportSchedule[]; error?: string };
        if (response.status === 503) {
          if (active) {
            setScheduleAvailable(false);
            setScheduleError(copy.scheduleMissing);
          }
          return;
        }
        if (!response.ok) throw new Error(body.error || copy.errors.report);
        if (active) {
          setSchedules(body.schedules ?? []);
          setScheduleAvailable(true);
          setScheduleError("");
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setScheduleAvailable(false);
          setScheduleError(cause instanceof Error ? cause.message : copy.errors.report);
        }
      });
    return () => { active = false; };
  }, [copy.errors.report]);

  async function loadReport(
    selectedCategory: ReportCategory,
    start: string,
    end: string,
    selectedEntity: string,
  ) {
    setLoading(true);
    setError("");
    try {
      setReport(await fetchReportData(selectedCategory, start, end, selectedEntity, copy.errors.report));
    } catch (cause) {
      setReport(null);
      setError(cause instanceof Error ? cause.message : copy.errors.report);
    } finally {
      setLoading(false);
    }
  }

  async function exportExcel() {
    if (!report || !category) return;
    setExporting(true);
    setError("");
    try {
      const currentReport = await fetchReportData(category, from, to, entityId, copy.errors.report);
      setReport(currentReport);
      if (currentReport.truncated) {
        setError(copy.truncated);
        return;
      }
      const summaryRows = (currentReport.financialSummary ?? []).map((row) => {
        const metric = row.metric ?? "";
        const metricLabel = Object.hasOwn(copy.financialMetrics, metric)
          ? copy.financialMetrics[metric as keyof typeof copy.financialMetrics]
          : metric;
        return { ...row, metric: metricLabel, subject: row.subject || metricLabel };
      });
      const output = buildXlsx(
        columns.map((key) => ({ key, header: copy.columns[key as keyof typeof copy.columns] })),
        currentReport.rows,
        copy[category],
        {
          organization: copy.organization,
          title: copy[category],
          period: `${copy.from}: ${formatDate(currentReport.from)} – ${copy.to}: ${formatDate(currentReport.to)} · ${copy.entity}: ${selectedCatalog?.entities.find((entity) => entity.id === entityId)?.name ?? copy.allEntities}`,
          generatedAt: `${copy.generated}: ${formatDate(currentReport.generatedAt, true)}`,
        },
        summaryRows.length ? [{
          columns: financialSummaryColumns.map((key) => ({
            key,
            header: copy.columns[key as keyof typeof copy.columns],
          })),
          rows: summaryRows,
          sheetName: copy.financialSummaryTitle,
        }] : [],
      );
      const blob = new Blob([new Uint8Array(output)], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `mojo-${category}-${currentReport.from}-${currentReport.to}.xlsx`;
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      try {
        anchor.click();
      } finally {
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (cause) {
      console.error("Unable to export report to Excel.", cause);
      setError(cause instanceof Error ? cause.message : copy.errors.export);
    } finally {
      setExporting(false);
    }
  }

  async function createSchedule() {
    if (!category) return;
    setSavingSchedule(true);
    setError("");
    try {
      const response = await fetch("/api/v1/reports/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          frequency,
          entityId: entityId || undefined,
          windowDays,
        }),
      });
      const body = await response.json() as { schedule?: ReportSchedule; error?: string };
      const created = body.schedule;
      if (!response.ok || !created) throw new Error(body.error || copy.errors.report);
      setSchedules((current) => [...current, created].sort((a, b) => a.next_run_at.localeCompare(b.next_run_at)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.errors.report);
    } finally {
      setSavingSchedule(false);
    }
  }

  async function deleteSchedule(id: string) {
    setRemovingSchedule(id);
    setError("");
    try {
      const response = await fetch(`/api/v1/reports/schedules?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || copy.errors.report);
      setSchedules((current) => current.filter((schedule) => schedule.id !== id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.errors.report);
    } finally {
      setRemovingSchedule("");
    }
  }

  const numberFormat = new Intl.NumberFormat(locale === "ht" ? "ht-HT" : locale === "en" ? "en-US" : "fr-FR", {
    maximumFractionDigits: 2,
  });
  const currencyFormat = new Intl.NumberFormat(locale === "ht" ? "ht-HT" : locale === "en" ? "en-US" : "fr-FR", {
    style: "currency", currency: "USD", maximumFractionDigits: 2,
  });
  const formatSummaryValue = (row: ReportRow, key: string) => {
    const value = row[key];
    if (value === null || value === undefined) return "—";
    if (["balance", "target_amount", "planned_amount", "actual_amount"].includes(key)) {
      return new Intl.NumberFormat(dateLocale, {
        style: "currency",
        currency: row.currency?.trim() || "USD",
        maximumFractionDigits: 2,
      }).format(Number(value));
    }
    if (["income_usd", "expense_usd", "net_usd"].includes(key)) {
      return currencyFormat.format(Number(value));
    }
    if (key === "net_margin_pct") return `${numberFormat.format(Number(value))}%`;
    if (key === "missing_rate_count") return numberFormat.format(Number(value));
    if (key === "metric" && row.metric) {
      return Object.hasOwn(copy.financialMetrics, row.metric)
        ? copy.financialMetrics[row.metric as keyof typeof copy.financialMetrics]
        : row.metric;
    }
    if (key === "subject" && !value) {
      return row.metric && Object.hasOwn(copy.financialMetrics, row.metric)
        ? copy.financialMetrics[row.metric as keyof typeof copy.financialMetrics]
        : "—";
    }
    return value;
  };
  const maximumTrendValue = Math.max(1, ...monthTrend.flatMap(([, values]) => [values.income, values.expense]));

  return (
    <section className="reports-shell">
      <header className="page-heading reports-heading">
        <div>
          <span className="eyebrow">{copy.eyebrow}</span>
          <h1>{copy.title}<span className="heading-period">.</span></h1>
          <p>{copy.intro}</p>
        </div>
        <span className="reports-live"><span /> {catalog.length} / {categories.length}</span>
      </header>

      <section className="reports-filter-panel" aria-label={copy.title}>
        <label>
          <span>{copy.category}</span>
          <select value={category} onChange={(event) => {
            setCategory(event.target.value as ReportCategory);
            setEntityId("");
          }}>
            {catalog.map((item) => <option key={item.category} value={item.category}>{copy[item.category]}</option>)}
          </select>
        </label>
        <label><span>{copy.from}</span><input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} /></label>
        <label><span>{copy.to}</span><input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} /></label>
        <label className="reports-entity-filter">
          <span>{copy.entity}</span>
          <select value={entityId} onChange={(event) => setEntityId(event.target.value)}>
            <option value="">{copy.allEntities}</option>
            {selectedCatalog?.entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
          </select>
        </label>
        <button className="button button-primary reports-apply" type="button" disabled={!category || loading} onClick={() => category && void loadReport(category, from, to, entityId)}>
          {loading ? copy.loading : copy.apply}
        </button>
      </section>

      {error && <p className="reports-alert" role="alert">{error}</p>}

      {category ? (
        <section className="reports-result">
          {report && <header className="reports-print-header">
            <Image src="/mojo-logo.png" alt={copy.organization} width={1820} height={820} />
            <div>
              <span>{copy.organization}</span>
              <h2>{copy[category]}</h2>
              <p>{copy.descriptions[category]}</p>
              <p>{copy.from}: {formatDate(report.from)} – {copy.to}: {formatDate(report.to)}</p>
              <p>{copy.entity}: {selectedCatalog?.entities.find((entity) => entity.id === entityId)?.name ?? copy.allEntities}</p>
              <small>{copy.generated}: {formatDate(report.generatedAt, true)}</small>
            </div>
          </header>}
          <div className="reports-result-heading">
            <div>
              <span className="eyebrow">{copy[category]}</span>
              <h2>{copy.descriptions[category]}</h2>
            </div>
            <div className="reports-actions">
              <button className="button button-secondary" type="button" onClick={() => window.print()} disabled={!report || loading}>{copy.pdf}</button>
              <button className="button button-secondary" type="button" onClick={() => void exportExcel()} disabled={!report || loading || exporting}>
                {exporting ? copy.loading : copy.excel}
              </button>
            </div>
          </div>

          {report && category === "finance" && report.financialSummary?.length ? (
            <section className="reports-financial-summary" aria-label={copy.financialSummaryTitle}>
              <header>
                <h3>{copy.financialSummaryTitle}</h3>
                <p>{copy.financialSummaryNote}</p>
              </header>
              <div className="reports-table-scroll">
                <table className="reports-table">
                  <thead><tr>{financialSummaryColumns.map((key) => <th key={key}>{copy.columns[key as keyof typeof copy.columns]}</th>)}</tr></thead>
                  <tbody>
                    {report.financialSummary.map((row, index) => (
                      <tr key={`${index}-${row.entity}-${row.metric}-${row.subject}-${row.currency}`}>
                        {financialSummaryColumns.map((key) => (
                          <td key={key} className={key === "balance" || key === "target_amount" || key === "planned_amount" || key === "actual_amount" || key.endsWith("_usd") || key === "net_margin_pct" ? "reports-numeric" : undefined}>
                            {formatSummaryValue(row, key)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {report && category === "finance" && monthTrend.length > 0 && (
            <section className="reports-trend" aria-label={copy.descriptions.finance}>
              <div className="reports-trend-legend"><span><i className="reports-income-dot" />{copy.columns.income_usd}</span><span><i className="reports-expense-dot" />{copy.columns.expense_usd}</span></div>
              <div className="reports-trend-bars">
                {monthTrend.map(([month, values]) => (
                  <div className="reports-trend-month" key={month} title={`${month} · ${currencyFormat.format(values.income)} / ${currencyFormat.format(values.expense)}`}>
                    <div className="reports-trend-pair">
                      <span className="reports-trend-income" style={{ height: values.income > 0 ? `${Math.max(3, values.income / maximumTrendValue * 100)}%` : "0%" }} />
                      <span className="reports-trend-expense" style={{ height: values.expense > 0 ? `${Math.max(3, values.expense / maximumTrendValue * 100)}%` : "0%" }} />
                    </div>
                    <small>{month.slice(5)}</small>
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className="reports-table-meta">
            <span>{report ? `${report.rowCount} ${copy.rows}` : copy.select}</span>
            {report && <time dateTime={report.generatedAt}>{copy.generated} {formatDate(report.generatedAt, true)}</time>}
          </div>
          {report?.truncated && <p className="reports-truncated" role="status">{copy.truncated}</p>}
          {loading ? <div className="reports-empty" aria-live="polite">{copy.loading}</div>
            : report?.rows.length ? (
              <div className="reports-table-scroll">
                <table className="reports-table">
                  <thead><tr>{columns.map((key) => <th key={key}>{copy.columns[key as keyof typeof copy.columns]}</th>)}</tr></thead>
                  <tbody>
                    {report.rows.map((row, index) => (
                      <tr key={`${index}-${String(row.period ?? row.project ?? row.campaign ?? row.entity ?? "")}`}>
                        {columns.map((key) => {
                          const value = row[key];
                          const formatted = key.endsWith("_usd") && value !== null
                            ? currencyFormat.format(Number(value))
                            : key === "progress_pct" && value !== null
                              ? `${numberFormat.format(Number(value))}%`
                              : value ?? "—";
                          return <td key={key} className={key.endsWith("_usd") || key === "budget" || key === "estimated" ? "reports-numeric" : undefined}>{formatted}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="reports-empty">{report ? copy.noRows : copy.select}</div>}
        </section>
      ) : !error && <div className="reports-empty">{copy.select}</div>}

      {category && (
        <section className="reports-schedule-panel">
          <div className="reports-schedule-heading">
            <div><span className="eyebrow">{copy.eyebrow}</span><h2>{copy.scheduleTitle}</h2><p>{copy.scheduleDescription}</p></div>
          </div>
          <div className="reports-schedule-form">
            <label><span>{copy.frequency}</span><select value={frequency} onChange={(event) => setFrequency(event.target.value as ReportSchedule["frequency"])}>
              <option value="daily">{copy.daily}</option><option value="weekly">{copy.weekly}</option><option value="monthly">{copy.monthly}</option>
            </select></label>
            <label><span>{copy.window}</span><select value={windowDays} onChange={(event) => setWindowDays(Number(event.target.value) as 7 | 30 | 90 | 365)}>
              <option value={7}>{copy.days7}</option><option value={30}>{copy.days30}</option><option value={90}>{copy.days90}</option><option value={365}>{copy.days365}</option>
            </select></label>
            <button className="button button-primary" type="button" disabled={!scheduleAvailable || savingSchedule} onClick={() => void createSchedule()}>
              {savingSchedule ? copy.scheduling : copy.createSchedule}
            </button>
          </div>
          {!scheduleAvailable && <p className="reports-alert" role="status">{scheduleError || copy.scheduleMissing}</p>}
          <p className="reports-schedule-note">{copy.scheduleNote}</p>
          <div className="reports-schedule-list">
            <h3>{copy.schedules}</h3>
            {scheduleAvailable && schedules.length ? schedules.map((schedule) => (
              <article key={schedule.id}>
                <div><strong>{copy[schedule.category]}</strong><span>{copy[schedule.frequency]} · {schedule.window_days} d{schedule.entity_name ? ` · ${schedule.entity_name}` : ""}</span></div>
                <time dateTime={schedule.next_run_at}>{copy.nextRun}: {new Intl.DateTimeFormat(locale === "ht" ? "ht-HT" : locale === "en" ? "en-US" : "fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(schedule.next_run_at))} UTC</time>
                <button className="table-action" type="button" disabled={removingSchedule === schedule.id || !scheduleAvailable} onClick={() => void deleteSchedule(schedule.id)}>{removingSchedule === schedule.id ? copy.loading : copy.removeSchedule}</button>
              </article>
            )) : scheduleAvailable && <p className="reports-no-schedules">{copy.noSchedules}</p>}
          </div>
        </section>
      )}
    </section>
  );
}
