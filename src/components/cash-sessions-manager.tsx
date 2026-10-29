"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Locale } from "@/lib/auth";
import { translate } from "@/lib/i18n";
import { formatMoney } from "@/lib/money.mjs";

interface CashAccount {
  id: string;
  entity_id: string;
  entity_name: string;
  name: string;
  currency: "HTG" | "USD";
  cash_ceiling: string | null;
  cash_variance_tolerance: string | null;
  balance: string;
  session_id: string | null;
  session_status: "open" | "closed" | null;
  opening_count: string | null;
  opening_expected: string | null;
  closing_count: string | null;
  closing_expected: string | null;
}

interface ApiError { error?: string }

function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function CashSessionsManager({
  locale,
  canAccess,
  canManage,
}: {
  locale: Locale;
  canAccess: boolean;
  canManage: boolean;
}) {
  const text = useCallback((key: Parameters<typeof translate>[1]) => translate(locale, key), [locale]);
  const [date, setDate] = useState(localDate);
  const [accounts, setAccounts] = useState<CashAccount[]>([]);
  const [loading, setLoading] = useState(canAccess);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [savingAccountId, setSavingAccountId] = useState("");

  const loadSessions = useCallback(async () => {
    const response = await fetch(`/api/v1/finance/cash-sessions?date=${encodeURIComponent(date)}`);
    if (!response.ok) {
      const body = await response.json().catch(() => null) as ApiError | null;
      throw new Error(body?.error ?? text("requestFailed"));
    }
    const result = await response.json() as { accounts: CashAccount[] };
    setAccounts(result.accounts);
  }, [date, text]);

  useEffect(() => {
    let cancelled = false;
    if (canAccess) {
      loadSessions().catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : text("requestFailed"));
      }).finally(() => {
        if (!cancelled) setLoading(false);
      });
    }
    return () => { cancelled = true; };
  }, [canAccess, date, loadSessions, text]);

  async function saveSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const accountId = String(form.get("accountId"));
    setSavingAccountId(accountId);
    setError("");
    setNotice("");
    try {
      const action = String(form.get("action"));
      const response = await fetch("/api/v1/finance/cash-sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          accountId,
          date,
          countedAmount: form.get("countedAmount"),
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as ApiError | null;
        setError(body?.error ?? text("requestFailed"));
        return;
      }
      setNotice(text(action === "open" ? "cashSessionOpened" : "cashSessionClosed"));
      await loadSessions();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text("requestFailed"));
    } finally {
      setSavingAccountId("");
    }
  }

  if (!canAccess) return null;

  return (
    <section className="panel finance-panel cash-sessions-panel">
      <div className="panel-heading">
        <div><span className="eyebrow">{text("finance").toUpperCase()}</span><h2>{text("cashSessions")}</h2></div>
        <label className="cash-date-filter">{text("sessionDate")}<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="success-message" role="status">{notice}</p>}
      {loading ? <p className="muted">{text("loading")}</p> : accounts.length ? (
        <div className="cash-account-list">
          {accounts.map((account) => (
            <article className="cash-account-card" key={account.id}>
              <div className="panel-heading">
                <div><strong>{account.name}</strong><span className="table-sub">{account.entity_name} · {account.currency}</span></div>
                {account.session_status && <span className="phase-tag">{text(account.session_status === "open" ? "cashOpen" : "cashClosed")}</span>}
              </div>
              <p className="cash-system-balance">{text("expectedAmount")}: <strong>{formatMoney(account.balance, account.currency, locale)}</strong></p>
              {account.cash_ceiling === null || account.cash_variance_tolerance === null ? (
                <p className="muted">{text("cashNeedsConfiguration")}</p>
              ) : account.session_status === "closed" ? (
                <p className="muted">{text("countedAmount")}: {formatMoney(account.closing_count ?? "0", account.currency, locale)}</p>
              ) : (
                <>
                  {account.session_status === "open" && (
                    <p className="muted">{text("expectedAmount")}: {formatMoney(account.opening_count ?? "0", account.currency, locale)}</p>
                  )}
                  {canManage && (
                    <form className="cash-session-form" onSubmit={(event) => void saveSession(event)}>
                      <input type="hidden" name="accountId" value={account.id} />
                      <input type="hidden" name="action" value={account.session_status === "open" ? "close" : "open"} />
                      <label>{text("countedAmount")}<input name="countedAmount" type="number" min="0" step="0.01" required /></label>
                      <button className="button button-primary" type="submit" disabled={savingAccountId === account.id}>
                        {savingAccountId === account.id ? text("saving") : text(account.session_status === "open" ? "closeCash" : "openCash")}
                      </button>
                    </form>
                  )}
                </>
              )}
            </article>
          ))}
        </div>
      ) : <p className="empty-state">{text("noCashAccounts")}</p>}
    </section>
  );
}
