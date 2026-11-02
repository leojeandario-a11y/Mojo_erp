"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Locale } from "@/lib/auth";
import { translate } from "@/lib/i18n";
import { formatMoney } from "@/lib/money.mjs";

type Currency = "HTG" | "USD";
type FundTab = "overview" | "rates" | "contributions" | "withdrawals" | "reports";

interface FundAccount {
  id: string;
  name: string;
  currency: Currency;
  available: boolean;
}

interface EmergencyFund {
  id: string;
  name: string;
  target_amount: string | null;
  currency: Currency;
  account_id: string | null;
  account_name: string | null;
  balance: string;
  percentage: string | null;
  effective_from: string | null;
  progress_percentage: string | null;
}

interface FundResponse {
  fund: EmergencyFund | null;
  accounts: FundAccount[];
  canReadRates: boolean;
  canReadContributions: boolean;
  canReadWithdrawals: boolean;
  canReadReports: boolean;
  canConfigure: boolean;
  canChangeAccount: boolean;
}

interface FundRate {
  id: string;
  percentage: string;
  effective_from: string;
  reason: string | null;
  approval_status: "pending" | "approved" | "rejected";
  requested_by: string | null;
}

interface FundContribution {
  id: string;
  amount: string;
  currency: Currency;
  contribution_date: string;
  kind: "automatic" | "manual";
  reason: string | null;
  source_number: string | null;
  fund_transaction_number: string | null;
  created_by: string | null;
  reversal_transaction_id: string | null;
  reversal_transaction_number: string | null;
}

interface FundWithdrawal {
  id: string;
  amount: string;
  currency: Currency;
  requested_amount: string;
  requested_currency: Currency;
  requested_date: string;
  reason: string;
  status: "pending" | "approved" | "rejected" | "disbursed" | "cancelled" | "reversed";
  requested_at: string;
  requested_by: string;
  requester_name: string;
  transaction_id: string | null;
  transaction_number: string | null;
  approval_request_id: string | null;
  documents: { id: string; fileName: string; downloadUrl: string; createdAt: string }[];
}

interface FundReport {
  from: string;
  to: string;
  currency: Currency;
  summary: {
    opening_balance: string;
    contributions: string;
    contribution_reversals: string;
    withdrawals: string;
    withdrawal_reversals: string;
    closing_balance: string;
    target_amount: string | null;
    progress_percentage: string | null;
  };
  contributions: {
    date: string;
    kind: "automatic" | "manual" | "reversal";
    amount: string;
    currency: Currency;
    reason: string | null;
    source_transaction: string | null;
  }[];
  withdrawals: {
    date: string;
    amount: string;
    currency: Currency;
    reason: string;
    transaction_number: string;
    kind: "disbursement" | "reversal";
  }[];
}

interface ApiError {
  error?: string;
}

const tabLabels: Record<FundTab, Parameters<typeof translate>[1]> = {
  overview: "fundOverviewTab",
  rates: "fundRatesTab",
  contributions: "fundContributionsTab",
  withdrawals: "fundWithdrawalsTab",
  reports: "fundReportsTab",
};

function localDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function EmergencyFundManager({ locale }: { locale: Locale }) {
  const text = useCallback((key: Parameters<typeof translate>[1]) => translate(locale, key), [locale]);
  const [data, setData] = useState<FundResponse | null>(null);
  const [accountId, setAccountId] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [today, setToday] = useState("");
  const [activeTab, setActiveTab] = useState<FundTab>("overview");
  const [rates, setRates] = useState<FundRate[]>([]);
  const [contributions, setContributions] = useState<FundContribution[]>([]);
  const [withdrawals, setWithdrawals] = useState<FundWithdrawal[]>([]);
  const [report, setReport] = useState<FundReport | null>(null);
  const [canSetRate, setCanSetRate] = useState(false);
  const [canContribute, setCanContribute] = useState(false);
  const [canRequestWithdrawal, setCanRequestWithdrawal] = useState(false);
  const [canDisburse, setCanDisburse] = useState(false);
  const [ratePercentage, setRatePercentage] = useState("");
  const [rateDate, setRateDate] = useState("");
  const [rateReason, setRateReason] = useState("");
  const [contributionAmount, setContributionAmount] = useState("");
  const [contributionCurrency, setContributionCurrency] = useState<Currency>("HTG");
  const [contributionDate, setContributionDate] = useState("");
  const [contributionReason, setContributionReason] = useState("");
  const [withdrawalAmount, setWithdrawalAmount] = useState("");
  const [withdrawalCurrency, setWithdrawalCurrency] = useState<Currency>("HTG");
  const [withdrawalDate, setWithdrawalDate] = useState("");
  const [withdrawalReason, setWithdrawalReason] = useState("");
  const [reportPeriod, setReportPeriod] = useState<"monthly" | "quarterly" | "annual">("monthly");
  const [reportYear, setReportYear] = useState(String(new Date().getFullYear()));
  const [reportIndex, setReportIndex] = useState(String(new Date().getMonth() + 1));
  const [loading, setLoading] = useState(true);
  const [sectionLoading, setSectionLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/v1/finance/emergency-fund");
    const body = await response.json() as Partial<FundResponse> & ApiError;
    if (!response.ok) throw new Error(body.error ?? text("requestFailed"));
    if (!body.fund && !Array.isArray(body.accounts)) throw new Error(text("requestFailed"));
    const result = body as FundResponse;
    setData(result);
    setAccountId((current) => current || result.fund?.account_id
      || result.accounts.find((account) => account.available)?.id || "");
    setTargetAmount(result.fund?.target_amount ?? "");
    if (result.fund) {
      setContributionCurrency(result.fund.currency);
      setWithdrawalCurrency(result.fund.currency);
    }
  }, [text]);

  const loadTab = useCallback(async (tab: FundTab) => {
    if (tab === "overview" || tab === "reports") return;
    setSectionLoading(true);
    setError("");
    try {
      const path = tab === "rates" ? "rates" : tab === "contributions" ? "contributions" : "withdrawals";
      const response = await fetch(`/api/v1/finance/emergency-fund/${path}`);
      const body = await response.json() as ApiError & {
        rates?: FundRate[];
        canSetRate?: boolean;
        contributions?: FundContribution[];
        canContribute?: boolean;
        withdrawals?: FundWithdrawal[];
        canRequestWithdrawal?: boolean;
        canDisburse?: boolean;
      };
      if (!response.ok) throw new Error(body.error ?? text("requestFailed"));
      if (tab === "rates") {
        if (!Array.isArray(body.rates)) throw new Error(text("requestFailed"));
        setRates(body.rates);
        setCanSetRate(body.canSetRate === true);
      } else if (tab === "contributions") {
        if (!Array.isArray(body.contributions)) throw new Error(text("requestFailed"));
        setContributions(body.contributions);
        setCanContribute(body.canContribute === true);
      } else {
        if (!Array.isArray(body.withdrawals)) throw new Error(text("requestFailed"));
        setWithdrawals(body.withdrawals);
        setCanRequestWithdrawal(body.canRequestWithdrawal === true);
        setCanDisburse(body.canDisburse === true);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text("requestFailed"));
    } finally {
      setSectionLoading(false);
    }
  }, [text]);

  useEffect(() => {
    let cancelled = false;
    load().catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : text("requestFailed"));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    setToday(localDate());
    return () => { cancelled = true; };
  }, [load, text]);

  useEffect(() => {
    if (!loading && data?.fund && activeTab !== "overview" && activeTab !== "reports") {
      void loadTab(activeTab);
    }
  }, [activeTab, data?.fund, loadTab, loading]);

  async function configure(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setSaving(true);
    try {
      const response = await fetch("/api/v1/finance/emergency-fund", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accountId, targetAmount: targetAmount.trim() || null }),
      });
      const body = await response.json() as ApiError;
      if (!response.ok) throw new Error(body.error ?? text("requestFailed"));
      setNotice(text("fundConfigurationSaved"));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text("requestFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function submitJson(
    event: FormEvent<HTMLFormElement>,
    endpoint: string,
    payload: Record<string, string>,
    successKey: Parameters<typeof translate>[1],
  ) {
    event.preventDefault();
    setError("");
    setNotice("");
    setSaving(true);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json() as ApiError;
      if (!response.ok) throw new Error(body.error ?? text("requestFailed"));
      setNotice(text(successKey));
      await loadTab(activeTab);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text("requestFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function requestWithdrawal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setError("");
    setNotice("");
    setSaving(true);
    try {
      const response = await fetch("/api/v1/finance/emergency-fund/withdrawals", {
        method: "POST",
        body: new FormData(event.currentTarget),
      });
      const body = await response.json() as ApiError;
      if (!response.ok) throw new Error(body.error ?? text("requestFailed"));
      setNotice(text("fundWithdrawalSubmitted"));
      form.reset();
      setWithdrawalAmount("");
      setWithdrawalReason("");
      await loadTab("withdrawals");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text("requestFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function disburseWithdrawal(id: string) {
    setError("");
    setNotice("");
    setSaving(true);
    try {
      const response = await fetch(`/api/v1/finance/emergency-fund/withdrawals/${id}/disburse`, {
        method: "POST",
      });
      const body = await response.json() as ApiError;
      if (!response.ok) throw new Error(body.error ?? text("requestFailed"));
      setNotice(text("fundDisbursementRecorded"));
      await loadTab("withdrawals");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text("requestFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function loadReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setSectionLoading(true);
    setReport(null);
    try {
      const query = new URLSearchParams({ period: reportPeriod, year: reportYear });
      if (reportPeriod !== "annual") query.set("index", reportIndex);
      const response = await fetch(`/api/v1/finance/emergency-fund/reports?${query}`);
      const body = await response.json() as ApiError & FundReport;
      if (!response.ok) throw new Error(body.error ?? text("requestFailed"));
      setReport(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text("requestFailed"));
    } finally {
      setSectionLoading(false);
    }
  }

  const selectedAccount = data?.accounts.find((account) => account.id === accountId);
  const reportQuery = new URLSearchParams({ period: reportPeriod, year: reportYear });
  if (reportPeriod !== "annual") reportQuery.set("index", reportIndex);
  const reportExportUrl = `/api/v1/finance/emergency-fund/reports?${reportQuery}&format=csv`;
  const visibleTabs = (Object.keys(tabLabels) as FundTab[]).filter((tab) => {
    if (tab === "rates") return data?.canReadRates;
    if (tab === "contributions") return data?.canReadContributions;
    if (tab === "withdrawals") return data?.canReadWithdrawals;
    if (tab === "reports") return data?.canReadReports;
    return true;
  });

  return (
    <section className="panel finance-panel emergency-fund-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">{text("finance").toUpperCase()}</span>
          <h2>{text("emergencyFund")}</h2>
        </div>
        {data?.fund && <span className="count-pill">{formatMoney(data.fund.balance, data.fund.currency, locale)}</span>}
      </div>
      <p className="muted">{text("emergencyFundDescription")}</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="success-message" role="status">{notice}</p>}
      {loading ? <p className="muted">{text("loading")}</p> : (
        <>
          {data?.fund && (
            <div className="approval-tabs" role="tablist" aria-label={text("emergencyFund")}>
              {visibleTabs.map((tab) => (
                <button
                  key={tab}
                  id={`fund-tab-${tab}`}
                  className={`approval-tab ${activeTab === tab ? "active" : ""}`}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab}
                  aria-controls={`fund-panel-${tab}`}
                  onClick={() => setActiveTab(tab)}
                >
                  {text(tabLabels[tab])}
                </button>
              ))}
            </div>
          )}
          {activeTab === "overview" && (
            <div id="fund-panel-overview" role="tabpanel" aria-labelledby="fund-tab-overview">
              {data?.fund ? (
                <dl className="fund-summary">
                  <div><dt>{text("fundBalance")}</dt><dd>{formatMoney(data.fund.balance, data.fund.currency, locale)}</dd></div>
                  <div><dt>{text("fundAccount")}</dt><dd>{data.fund.account_name ?? text("notConfigured")}</dd></div>
                  <div><dt>{text("fundTarget")}</dt><dd>{data.fund.target_amount
                    ? formatMoney(data.fund.target_amount, data.fund.currency, locale)
                    : text("notConfigured")}</dd></div>
                  <div><dt>{text("fundRate")}</dt><dd>{data.fund.percentage === null
                    ? text("fundRateNotSet")
                    : `${data.fund.percentage}% · ${data.fund.effective_from}`}</dd></div>
                  {data.fund.target_amount && <div><dt>{text("fundProgress")}</dt><dd>
                    {data.fund.progress_percentage}% · {formatMoney(data.fund.target_amount, data.fund.currency, locale)}
                  </dd></div>}
                </dl>
              ) : <p className="empty-state">{text("fundNotConfigured")}</p>}
              {data?.canConfigure && (
                <form className="stack-form fund-configuration-form" onSubmit={(event) => void configure(event)}>
                  <h3>{text(data.fund ? "fundEditConfiguration" : "fundInitialConfiguration")}</h3>
                  <label>
                    {text("fundAccount")}
                    <select
                      required
                      value={accountId}
                      disabled={saving || (!!data.fund && !data.canChangeAccount)}
                      onChange={(event) => setAccountId(event.target.value)}
                    >
                      <option value="">{text("selectFundAccount")}</option>
                      {data.accounts.filter((account) => account.available).map((account) => (
                        <option key={account.id} value={account.id}>{account.name} · {account.currency}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {text("fundTargetOptional")}
                    <input type="number" min="0.01" step="0.01" value={targetAmount} disabled={saving}
                      onChange={(event) => setTargetAmount(event.target.value)} />
                  </label>
                  {selectedAccount && <p className="muted">{text("fundCurrency")}: {selectedAccount.currency}</p>}
                  <button className="button button-primary" type="submit" disabled={saving || !accountId}>
                    {saving ? text("saving") : text("saveFundConfiguration")}
                  </button>
                </form>
              )}
            </div>
          )}
          {activeTab !== "overview" && (
            <div
              id={`fund-panel-${activeTab}`}
              className={activeTab === "reports" ? "fund-report-print" : undefined}
              role="tabpanel"
              aria-labelledby={`fund-tab-${activeTab}`}
            >
              {sectionLoading && <p className="muted">{text("loading")}</p>}
              {activeTab === "rates" && (
                <>
                  {canSetRate && (
                    <form className="stack-form fund-operation-form" onSubmit={(event) => void submitJson(
                      event,
                      "/api/v1/finance/emergency-fund/rates",
                      { percentage: ratePercentage, effectiveFrom: rateDate, reason: rateReason },
                      "fundRateSubmitted",
                    )}>
                      <h3>{text("fundProposeRate")}</h3>
                      <label>{text("fundPercentage")}<input type="number" min="0" max="100" step="0.01"
                        required value={ratePercentage} onChange={(event) => setRatePercentage(event.target.value)} /></label>
                      <label>{text("fundEffectiveDate")}<input type="date" required min={today} value={rateDate}
                        onChange={(event) => setRateDate(event.target.value)} /></label>
                      <label>{text("fundReason")}<textarea minLength={3} maxLength={500} required value={rateReason}
                        onChange={(event) => setRateReason(event.target.value)} /></label>
                      <button className="button button-primary" type="submit" disabled={saving || !rateDate}>
                        {saving ? text("saving") : text("fundSubmitRate")}
                      </button>
                    </form>
                  )}
                  <h3>{text("fundRateHistory")}</h3>
                  {rates.length ? <div className="approval-list">{rates.map((rate) => (
                    <article className="approval-card" key={rate.id}>
                      <div className="approval-card-heading"><h3>{rate.percentage}%</h3>
                        <strong>{rate.approval_status === "approved" ? text("fundRateApproved")
                          : rate.approval_status === "rejected" ? text("fundRateRejected") : text("fundRatePending")}</strong>
                      </div>
                      <p className="approval-card-meta">{rate.effective_from}{rate.requested_by ? ` · ${rate.requested_by}` : ""}</p>
                      {rate.reason && <p>{rate.reason}</p>}
                    </article>
                  ))}</div> : <p className="empty-state">{text("fundNoEntries")}</p>}
                </>
              )}
              {activeTab === "contributions" && (
                <>
                  {canContribute && data?.fund && (
                    <form className="stack-form fund-operation-form" onSubmit={(event) => void submitJson(
                      event,
                      "/api/v1/finance/emergency-fund/contributions",
                      {
                        amount: contributionAmount,
                        currency: contributionCurrency,
                        date: contributionDate,
                        reason: contributionReason,
                      },
                      "fundContributionSubmitted",
                    )}>
                      <h3>{text("fundManualContribution")}</h3>
                      <label>{text("purchaseAmount")}<input type="number" min="0.01" step="0.01" required
                        value={contributionAmount} onChange={(event) => setContributionAmount(event.target.value)} /></label>
                      <label>{text("purchaseCurrency")}<select value={contributionCurrency}
                        onChange={(event) => setContributionCurrency(event.target.value as Currency)}>
                        <option value="HTG">HTG</option><option value="USD">USD</option>
                      </select></label>
                      <label>{text("fundDate")}<input type="date" required value={contributionDate}
                        onChange={(event) => setContributionDate(event.target.value)} /></label>
                      <label>{text("fundReasonRequired")}<textarea minLength={3} maxLength={500} required
                        value={contributionReason} onChange={(event) => setContributionReason(event.target.value)} /></label>
                      <button className="button button-primary" type="submit" disabled={saving || !contributionDate}>
                        {saving ? text("saving") : text("fundManualContribution")}
                      </button>
                    </form>
                  )}
                  {contributions.length ? <div className="approval-list">{contributions.map((item) => (
                    <article className="approval-card" key={item.id}>
                      <div className="approval-card-heading"><h3>{formatMoney(item.amount, item.currency, locale)}</h3>
                        <strong>{item.kind === "automatic" ? text("fundRate") : text("fundManualContribution")}</strong>
                      </div>
                      <p className="approval-card-meta">{item.contribution_date}
                        {item.source_number ? ` · ${item.source_number}` : ""}
                        {item.fund_transaction_number ? ` · ${item.fund_transaction_number}` : ""}
                        {item.reversal_transaction_number
                          ? ` · ${text("fundReversed")} · ${item.reversal_transaction_number}` : ""}
                      </p>
                      {item.reason && <p>{item.reason}</p>}
                    </article>
                  ))}</div> : <p className="empty-state">{text("fundNoEntries")}</p>}
                </>
              )}
              {activeTab === "withdrawals" && (
                <>
                  {canRequestWithdrawal && data?.fund && (
                    <form className="stack-form fund-operation-form" encType="multipart/form-data"
                      onSubmit={(event) => void requestWithdrawal(event)}>
                      <h3>{text("fundRequestWithdrawal")}</h3>
                      <label>{text("purchaseAmount")}<input name="amount" type="number" min="0.01" step="0.01"
                        required value={withdrawalAmount} onChange={(event) => setWithdrawalAmount(event.target.value)} /></label>
                      <label>{text("purchaseCurrency")}<select name="currency" value={withdrawalCurrency}
                        onChange={(event) => setWithdrawalCurrency(event.target.value as Currency)}>
                        <option value="HTG">HTG</option><option value="USD">USD</option>
                      </select></label>
                      <label>{text("fundDate")}<input name="date" type="date" required value={withdrawalDate}
                        onChange={(event) => setWithdrawalDate(event.target.value)} /></label>
                      <label>{text("fundReasonRequired")}<textarea name="reason" minLength={3} maxLength={500} required
                        value={withdrawalReason} onChange={(event) => setWithdrawalReason(event.target.value)} /></label>
                      <label>{text("fundUploadDocuments")}<input name="documents" type="file" accept=".pdf,.jpg,.jpeg,.png"
                        multiple required /></label>
                      <button className="button button-primary" type="submit" disabled={saving || !withdrawalDate}>
                        {saving ? text("saving") : text("fundRequestWithdrawal")}
                      </button>
                    </form>
                  )}
                  <h3>{text("fundWithdrawalHistory")}</h3>
                  {withdrawals.length ? <div className="approval-list">{withdrawals.map((item) => (
                    <article className="approval-card" key={item.id}>
                      <div className="approval-card-heading">
                        <div><h3>{formatMoney(item.amount, item.currency, locale)}</h3>
                          <p>{item.requester_name} · {item.requested_date}</p></div>
                        <strong>{text(item.status === "approved" ? "fundStatusApproved"
                          : item.status === "rejected" ? "fundStatusRejected"
                            : item.status === "disbursed" ? "fundStatusDisbursed"
                              : item.status === "reversed" ? "fundStatusReversed" : "fundStatusPending")}</strong>
                      </div>
                      <p>{item.reason}</p>
                      {item.transaction_number && <p className="approval-card-meta">{item.transaction_number}</p>}
                      {item.documents.map((document) => (
                        <p key={document.id}><a href={document.downloadUrl}>{document.fileName}</a></p>
                      ))}
                      {canDisburse && item.status === "approved" && !item.transaction_id && (
                        <button className="button button-primary" type="button" disabled={saving}
                          onClick={() => void disburseWithdrawal(item.id)}>
                          {saving ? text("saving") : text("fundDisburse")}
                        </button>
                      )}
                    </article>
                  ))}</div> : <p className="empty-state">{text("fundNoEntries")}</p>}
                </>
              )}
              {activeTab === "reports" && data?.canReadReports && (
                <>
                  <p className="muted">{text("fundReportsDescription")}</p>
                  <form className="stack-form fund-report-filters" onSubmit={(event) => void loadReport(event)}>
                    <label>{text("fundReportPeriod")}<select value={reportPeriod} onChange={(event) => {
                      const period = event.target.value as typeof reportPeriod;
                      setReportPeriod(period);
                      setReportIndex(period === "quarterly" ? String(Math.ceil((new Date().getMonth() + 1) / 3))
                        : String(new Date().getMonth() + 1));
                    }}>
                      <option value="monthly">{text("fundMonthly")}</option>
                      <option value="quarterly">{text("fundQuarterly")}</option>
                      <option value="annual">{text("fundAnnual")}</option>
                    </select></label>
                    <label>{text("fundYear")}<input type="number" min="2000" max="9998" required
                      value={reportYear} onChange={(event) => setReportYear(event.target.value)} /></label>
                    {reportPeriod !== "annual" && (
                      <label>{reportPeriod === "quarterly" ? text("fundQuarter") : text("month")}
                        <select value={reportIndex} onChange={(event) => setReportIndex(event.target.value)}>
                          {Array.from({ length: reportPeriod === "quarterly" ? 4 : 12 }, (_, index) => (
                            <option key={index + 1} value={index + 1}>{index + 1}</option>
                          ))}
                        </select>
                      </label>
                    )}
                    <button className="button button-primary" type="submit" disabled={sectionLoading}>
                      {sectionLoading ? text("loading") : text("fundReportsTab")}
                    </button>
                  </form>
                  {report && (
                    <>
                      <div className="approval-card-actions">
                        <a className="button button-secondary" href={reportExportUrl}>{text("fundDownloadReport")}</a>
                        <button className="button button-secondary" type="button" onClick={() => window.print()}>
                          {text("fundPrintReport")}
                        </button>
                      </div>
                      <p className="approval-card-meta">{report.from} – {report.to}</p>
                      <dl className="fund-summary">
                        <div><dt>{text("fundOpeningBalance")}</dt><dd>{formatMoney(report.summary.opening_balance, report.currency, locale)}</dd></div>
                        <div><dt>{text("fundContributionsTotal")}</dt><dd>{formatMoney(report.summary.contributions, report.currency, locale)}</dd></div>
                        <div><dt>{text("fundContributionReversals")}</dt><dd>{formatMoney(report.summary.contribution_reversals, report.currency, locale)}</dd></div>
                        <div><dt>{text("fundWithdrawalsTotal")}</dt><dd>{formatMoney(report.summary.withdrawals, report.currency, locale)}</dd></div>
                        <div><dt>{text("fundWithdrawalReversals")}</dt><dd>{formatMoney(report.summary.withdrawal_reversals, report.currency, locale)}</dd></div>
                        <div><dt>{text("fundClosingBalance")}</dt><dd>{formatMoney(report.summary.closing_balance, report.currency, locale)}</dd></div>
                        {report.summary.target_amount && <div><dt>{text("fundProgress")}</dt><dd>
                          {report.summary.progress_percentage}% · {formatMoney(report.summary.target_amount, report.currency, locale)}
                        </dd></div>}
                      </dl>
                      <h3>{text("fundContributionsTotal")}</h3>
                      <div className="approval-list">
                        {report.contributions.map((item, index) => (
                          <article className="approval-card" key={`${item.date}-${index}`}>
                            <div className="approval-card-heading"><h3>{formatMoney(item.amount, item.currency, locale)}</h3>
                              <strong>{item.date}{item.kind === "reversal" ? ` · ${text("fundReversed")}` : ""}</strong></div>
                            <p>{item.kind === "reversal" ? text("fundReversed") : item.reason ?? item.kind}
                              {item.source_transaction ? ` · ${item.source_transaction}` : ""}</p>
                          </article>
                        ))}
                        {!report.contributions.length && <p className="empty-state">{text("fundNoEntries")}</p>}
                      </div>
                      <h3>{text("fundWithdrawalsTotal")}</h3>
                      <div className="approval-list">
                        {report.withdrawals.map((item) => (
                          <article className="approval-card" key={item.transaction_number}>
                            <div className="approval-card-heading"><h3>{formatMoney(item.amount, item.currency, locale)}</h3>
                              <strong>{item.date}</strong></div>
                            <p>{item.kind === "reversal" ? text("fundReversed") : item.reason} · {item.transaction_number}</p>
                          </article>
                        ))}
                        {!report.withdrawals.length && <p className="empty-state">{text("fundNoEntries")}</p>}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
