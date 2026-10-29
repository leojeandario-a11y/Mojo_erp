"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { Locale } from "@/lib/auth";
import { translate } from "@/lib/i18n";

interface AccountOption {
  id: string;
  entity_id: string;
  entity_name: string;
  name: string;
  currency: "HTG" | "USD";
  is_active: boolean;
}

export function AccountTransfersManager({
  locale,
  canManage,
}: {
  locale: Locale;
  canManage: boolean;
}) {
  const text = useCallback((key: Parameters<typeof translate>[1]) => translate(locale, key), [locale]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [fromAccountId, setFromAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [loading, setLoading] = useState(canManage);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const source = accounts.find((account) => account.id === fromAccountId);
  const destinations = useMemo(
    () => accounts.filter((account) => account.id !== source?.id
      && account.entity_id === source?.entity_id
      && account.currency === source?.currency),
    [accounts, source],
  );

  useEffect(() => {
    let cancelled = false;
    if (!canManage) return () => { cancelled = true; };
    fetch("/api/v1/finance/accounts")
      .then(async (response) => {
        if (!response.ok) throw new Error(text("requestFailed"));
        const result = await response.json() as { accounts: AccountOption[] };
        if (cancelled) return;
        const active = result.accounts.filter((account) => account.is_active);
        setAccounts(active);
        setFromAccountId(active[0]?.id ?? "");
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : text("requestFailed"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [canManage, text]);

  useEffect(() => {
    if (!destinations.some((account) => account.id === toAccountId)) {
      setToAccountId(destinations[0]?.id ?? "");
    }
  }, [destinations, toAccountId]);

  async function createTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setError("");
    setNotice("");
    setSaving(true);
    try {
      const response = await fetch("/api/v1/finance/transfers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fromAccountId,
          toAccountId,
          date: form.get("date"),
          amount: form.get("amount"),
          description: String(form.get("description") ?? "").trim() || null,
        }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) {
        setError(result.error ?? text("requestFailed"));
        return;
      }
      setNotice(text("transferCreated"));
      formElement.reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text("requestFailed"));
    } finally {
      setSaving(false);
    }
  }

  if (!canManage) return null;

  return (
    <section className="panel finance-panel transfer-panel">
      <div className="panel-heading">
        <div><span className="eyebrow">{text("finance").toUpperCase()}</span><h2>{text("accountTransfers")}</h2></div>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="success-message" role="status">{notice}</p>}
      {loading ? <p className="muted">{text("loading")}</p> : accounts.length < 2 ? (
        <p className="empty-state">{text("noActiveAccounts")}</p>
      ) : (
        <form className="stack-form transfer-form" onSubmit={(event) => void createTransfer(event)}>
          <label>{text("fromAccount")}<select value={fromAccountId} onChange={(event) => setFromAccountId(event.target.value)} required>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>{account.entity_name} · {account.name} ({account.currency})</option>
            ))}
          </select></label>
          <label>{text("toAccount")}<select value={toAccountId} onChange={(event) => setToAccountId(event.target.value)} required disabled={!destinations.length}>
            {destinations.map((account) => (
              <option key={account.id} value={account.id}>{account.name} ({account.currency})</option>
            ))}
          </select></label>
          <label>{text("transactionDate")}<input name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label>
          <label>{text("amount")}<input name="amount" type="number" min="0.01" step="0.01" required /></label>
          <label>{text("description")}<textarea name="description" maxLength={500} rows={2} /></label>
          <button className="button button-primary" type="submit" disabled={saving || !destinations.length}>
            {saving ? text("saving") : text("accountTransfers")}
          </button>
        </form>
      )}
    </section>
  );
}
