"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Locale } from "@/lib/auth";
import { translate } from "@/lib/i18n";
import { formatExchangeRate, formatMoney } from "@/lib/money.mjs";

interface FinanceEntity {
  id: string;
  name: string;
}

interface FinanceAccount {
  id: string;
  entity_id: string;
  entity_name: string;
  name: string;
  account_type: "cash" | "bank" | "mobile_money" | "other";
  currency: "HTG" | "USD";
  bank_name: string | null;
  account_number_masked: string | null;
  opening_balance: string | null;
  cash_ceiling: string | null;
  cash_variance_tolerance: string | null;
  is_active: boolean;
}

interface ExchangeRate {
  id: string;
  rate_date: string;
  from_currency: "HTG" | "USD";
  to_currency: "HTG" | "USD";
  rate: string;
}

interface ApiError { error?: string }

async function getApiError(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null) as ApiError | null;
  return typeof body?.error === "string" ? body.error : fallback;
}

export function FinanceManager({
  locale,
  canReadAccounts,
  canManageRates,
}: {
  locale: Locale;
  canReadAccounts: boolean;
  canManageRates: boolean;
}) {
  const text = useCallback((key: Parameters<typeof translate>[1]) => translate(locale, key), [locale]);
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [entities, setEntities] = useState<FinanceEntity[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [rates, setRates] = useState<ExchangeRate[]>([]);
  const [accountLoading, setAccountLoading] = useState(canReadAccounts);
  const [ratesLoading, setRatesLoading] = useState(canManageRates);
  const [accountError, setAccountError] = useState("");
  const [rateError, setRateError] = useState("");
  const [accountNotice, setAccountNotice] = useState("");
  const [rateNotice, setRateNotice] = useState("");
  const [newEntityId, setNewEntityId] = useState("");
  const selected = accounts.find((account) => account.id === selectedId);

  const loadAccounts = useCallback(async () => {
    const response = await fetch("/api/v1/finance/accounts");
    if (!response.ok) throw new Error(await getApiError(response, text("requestFailed")));
    const data = await response.json() as { accounts: FinanceAccount[]; entities: FinanceEntity[] };
    setAccounts(data.accounts);
    setEntities(data.entities);
    setNewEntityId((current) => current || data.entities[0]?.id || "");
  }, [text]);

  const loadRates = useCallback(async () => {
    const response = await fetch("/api/v1/exchange-rates");
    if (!response.ok) throw new Error(await getApiError(response, text("requestFailed")));
    const data = await response.json() as { rates: ExchangeRate[] };
    setRates(data.rates);
  }, [text]);

  useEffect(() => {
    let cancelled = false;
    if (canReadAccounts) {
      loadAccounts().catch((cause: unknown) => {
        if (!cancelled) setAccountError(cause instanceof Error ? cause.message : text("requestFailed"));
      }).finally(() => {
        if (!cancelled) setAccountLoading(false);
      });
    }
    if (canManageRates) {
      loadRates().catch((cause: unknown) => {
        if (!cancelled) setRateError(cause instanceof Error ? cause.message : text("requestFailed"));
      }).finally(() => {
        if (!cancelled) setRatesLoading(false);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [canManageRates, canReadAccounts, loadAccounts, loadRates, text]);

  async function saveAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const account = {
      entityId: selected?.entity_id ?? String(form.get("entityId") ?? ""),
      name: String(form.get("name") ?? "").trim(),
      accountType: String(form.get("accountType") ?? ""),
      currency: String(form.get("currency") ?? ""),
      bankName: String(form.get("bankName") ?? "").trim() || null,
      accountNumberMasked: String(form.get("accountNumberMasked") ?? "").trim() || null,
      openingBalance: String(form.get("openingBalance") ?? "0"),
      cashCeiling: form.get("accountType") === "cash" ? String(form.get("cashCeiling") ?? "").trim() || null : null,
      cashVarianceTolerance: form.get("accountType") === "cash"
        ? String(form.get("cashVarianceTolerance") ?? "").trim() || null
        : null,
      isActive: form.get("isActive") === null ? true : form.get("isActive") === "true",
    };
    setAccountError("");
    setAccountNotice("");
    try {
      const response = await fetch("/api/v1/finance/accounts", {
        method: selected ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(selected ? { ...account, id: selected.id } : account),
      });
      if (!response.ok) {
        setAccountError(await getApiError(response, text("requestFailed")));
        return;
      }
      setSelectedId("");
      setAccountNotice(text(selected ? "accountUpdated" : "accountCreated"));
      await loadAccounts();
    } catch (cause) {
      setAccountError(cause instanceof Error ? cause.message : text("requestFailed"));
    }
  }

  async function saveRate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setRateError("");
    setRateNotice("");
    try {
      const response = await fetch("/api/v1/exchange-rates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          rateDate: form.get("rateDate"),
          fromCurrency: form.get("fromCurrency"),
          toCurrency: form.get("toCurrency"),
          rate: form.get("rate"),
        }),
      });
      if (!response.ok) {
        setRateError(await getApiError(response, text("requestFailed")));
        return;
      }
      const result = await response.json() as { updated: boolean };
      setRateNotice(text(result.updated ? "exchangeRateUpdated" : "exchangeRateSaved"));
      await loadRates();
    } catch (cause) {
      setRateError(cause instanceof Error ? cause.message : text("requestFailed"));
    }
  }

  return (
    <div className="finance-grid">
      {canReadAccounts ? (
        <section className="panel finance-panel">
          <div className="panel-heading">
            <div><span className="eyebrow">{text("finance").toUpperCase()}</span><h2>{text("accounts")}</h2></div>
            <span className="count-pill">{accounts.length}</span>
          </div>
          {accountLoading ? <p className="muted">{text("loading")}</p> : accountError ? <p className="form-error" role="alert">{accountError}</p>
            : accounts.length ? (
              <div className="table-scroll">
                <table>
                  <thead><tr><th>{text("accountName")}</th><th>{text("entity")}</th><th>{text("currency")}</th><th>{text("openingBalance")}</th><th>{text("state")}</th><th /></tr></thead>
                  <tbody>
                    {accounts.map((account) => (
                      <tr key={account.id}>
                        <td><strong>{account.name}</strong><span className="table-sub">{text(accountTypeKey(account.account_type))}{account.bank_name ? ` · ${account.bank_name}` : ""}</span></td>
                        <td>{account.entity_name}</td>
                        <td>{account.currency}</td>
                        <td>{account.opening_balance === null ? "—" : formatMoney(account.opening_balance, account.currency, locale)}</td>
                        <td>{text(account.is_active ? "active" : "inactive")}</td>
                        <td>{entities.some((entity) => entity.id === account.entity_id)
                          ? <button className="table-action" type="button" onClick={() => setSelectedId(account.id)}>{text("editAccount")}</button>
                          : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="empty-state">{text("noAccounts")}</p>}
          {accountNotice && <p className="success-message" role="status">{accountNotice}</p>}
          {entities.length > 0 ? (
            <form key={selected?.id ?? "new-account"} className="stack-form finance-form" onSubmit={saveAccount}>
              <div className="panel-heading"><div><span className="eyebrow">{selected ? text("editAccount").toUpperCase() : text("createFinanceAccount").toUpperCase()}</span><h2>{selected?.name ?? text("createFinanceAccount")}</h2></div></div>
              {!selected && <label>{text("entity")}<select name="entityId" required defaultValue={newEntityId}>
                {entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
              </select></label>}
              <label>{text("accountName")}<input name="name" required minLength={2} maxLength={120} defaultValue={selected?.name ?? ""} /></label>
              <label>{text("accountType")}<select name="accountType" defaultValue={selected?.account_type ?? "cash"}>
                <option value="cash">{text("cashAccount")}</option>
                <option value="bank">{text("bankAccount")}</option>
                <option value="mobile_money">{text("mobileMoneyAccount")}</option>
                <option value="other">{text("otherAccount")}</option>
              </select></label>
              <label>{text("currency")}<select name="currency" defaultValue={selected?.currency ?? "HTG"}>
                <option value="HTG">HTG</option><option value="USD">USD</option>
              </select></label>
              <label>{text("bankName")}<input name="bankName" maxLength={120} defaultValue={selected?.bank_name ?? ""} /></label>
              <label>{text("maskedAccountNumber")}<input name="accountNumberMasked" maxLength={80} defaultValue={selected?.account_number_masked ?? ""} /></label>
              <label>{text("cashCeiling")}<input name="cashCeiling" type="number" min="0.01" step="0.01" defaultValue={selected?.cash_ceiling ?? ""} />
                <small>{text("cashControlsHint")}</small>
              </label>
              <label>{text("cashVarianceTolerance")}<input name="cashVarianceTolerance" type="number" min="0" step="0.01" defaultValue={selected?.cash_variance_tolerance ?? ""} /></label>
              <label>{text("openingBalance")}<input name="openingBalance" type="number" step="0.01" defaultValue={selected?.opening_balance ?? "0"} required />
                {!selected && <small>{text("openingBalanceHint")}</small>}
              </label>
              {selected && <label>{text("state")}<select name="isActive" defaultValue={String(selected.is_active)}>
                <option value="true">{text("active")}</option><option value="false">{text("inactive")}</option>
              </select></label>}
              {accountError && <p className="form-error" role="alert">{accountError}</p>}
              <button className="button button-primary" type="submit">{text(selected ? "saveChanges" : "createFinanceAccount")}</button>
              {selected && <button className="button button-secondary" type="button" onClick={() => setSelectedId("")}>{text("cancel")}</button>}
            </form>
          ) : null}
        </section>
      ) : null}
      {canManageRates ? (
        <section className="panel finance-panel">
          <div className="panel-heading">
            <div><span className="eyebrow">{text("finance").toUpperCase()}</span><h2>{text("exchangeRates")}</h2></div>
            <span className="count-pill">{rates.length}</span>
          </div>
          <form className="stack-form finance-form" onSubmit={saveRate}>
            <label>{text("rateDate")}<input name="rateDate" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label>
            <label>{text("fromCurrency")}<select name="fromCurrency" defaultValue="USD"><option value="USD">USD</option><option value="HTG">HTG</option></select></label>
            <label>{text("toCurrency")}<select name="toCurrency" defaultValue="HTG"><option value="HTG">HTG</option><option value="USD">USD</option></select></label>
            <label>{text("rate")}<input name="rate" type="number" min="0.00000001" step="0.00000001" required /></label>
            {rateError && <p className="form-error" role="alert">{rateError}</p>}
            {rateNotice && <p className="success-message" role="status">{rateNotice}</p>}
            <button className="button button-primary" type="submit">{text("saveExchangeRate")}</button>
          </form>
          <div className="finance-rate-list">
            <div className="panel-heading"><div><span className="eyebrow">{text("history").toUpperCase()}</span></div></div>
            {ratesLoading ? <p className="muted">{text("loading")}</p> : rateError ? null : rates.length ? (
              <div className="table-scroll"><table>
                <thead><tr><th>{text("rateDate")}</th><th>{text("fromCurrency")} / {text("toCurrency")}</th><th>{text("rate")}</th></tr></thead>
                <tbody>{rates.map((rate) => <tr key={rate.id}>
                  <td>{rate.rate_date}</td><td>{rate.from_currency} / {rate.to_currency}</td>
                  <td>{formatExchangeRate(rate.rate, locale)}</td>
                </tr>)}</tbody>
              </table></div>
            ) : <p className="empty-state">{text("noExchangeRates")}</p>}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function accountTypeKey(accountType: FinanceAccount["account_type"]): Parameters<typeof translate>[1] {
  if (accountType === "cash") return "cashAccount";
  if (accountType === "bank") return "bankAccount";
  if (accountType === "mobile_money") return "mobileMoneyAccount";
  return "otherAccount";
}
