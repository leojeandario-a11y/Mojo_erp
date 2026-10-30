"use client";

import { Fragment, useCallback, useEffect, useState, type FormEvent } from "react";
import type { Locale } from "@/lib/auth";
import { translate } from "@/lib/i18n";
import { formatMoney } from "@/lib/money.mjs";

interface TransactionAccount {
  id: string;
  entity_id: string;
  entity_name: string;
  name: string;
  currency: "HTG" | "USD";
  is_active: boolean;
}

interface FinanceCategory {
  id: string;
  entity_id: string | null;
  code: string;
  name: string;
  kind: "income" | "expense";
}

interface FinanceTransaction {
  id: string;
  entity_id: string;
  entity_name: string;
  tx_number: string;
  tx_date: string;
  tx_type: "income" | "expense" | "transfer_in" | "transfer_out" | "adjustment";
  amount: string;
  currency: "HTG" | "USD";
  status: "draft" | "pending_approval" | "validated" | "rejected" | "reversed";
  created_by: string | null;
  description: string | null;
  account_name: string;
  category_name: string | null;
  reversal_of_id: string | null;
  canValidate: boolean;
  canSubmitApproval: boolean;
  canReverse: boolean;
}

interface ApiError { error?: string }

interface TransactionFilters {
  from: string;
  to: string;
  type: string;
  status: string;
  search: string;
}

function transactionQuery(filters: TransactionFilters, format?: "csv") {
  const params = new URLSearchParams();
  for (const key of ["from", "to", "type", "status", "search"] as const) {
    if (filters[key]) params.set(key, filters[key]);
  }
  if (format) params.set("format", format);
  return params.toString();
}

async function responseError(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null) as ApiError | null;
  return typeof body?.error === "string" ? body.error : fallback;
}

export function TransactionsManager({
  locale,
  canAccess,
  canCreate,
}: {
  locale: Locale;
  canAccess: boolean;
  canCreate: boolean;
}) {
  const text = useCallback((key: Parameters<typeof translate>[1]) => translate(locale, key), [locale]);
  const [accounts, setAccounts] = useState<TransactionAccount[]>([]);
  const [transactions, setTransactions] = useState<FinanceTransaction[]>([]);
  const [categories, setCategories] = useState<FinanceCategory[]>([]);
  const [accountId, setAccountId] = useState("");
  const [transactionType, setTransactionType] = useState<"income" | "expense">("expense");
  const [filters, setFilters] = useState<TransactionFilters>({
    from: "",
    to: "",
    type: "",
    status: "",
    search: "",
  });
  const [appliedFilters, setAppliedFilters] = useState<TransactionFilters>(filters);
  const [transactionLoading, setTransactionLoading] = useState(canAccess);
  const [accountsLoading, setAccountsLoading] = useState(canCreate);
  const [transactionError, setTransactionError] = useState("");
  const [accountError, setAccountError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [reversingId, setReversingId] = useState("");
  const selectedAccount = accounts.find((account) => account.id === accountId && account.is_active);
  const availableCategories = categories.filter((category) =>
    category.kind === transactionType
    && (category.entity_id === null || category.entity_id === selectedAccount?.entity_id),
  );
  const quickExpenseCategories = categories.filter((category) =>
    category.kind === "expense"
    && (category.entity_id === null || category.entity_id === selectedAccount?.entity_id),
  );

  const loadTransactions = useCallback(async () => {
    const query = transactionQuery(appliedFilters);
    const response = await fetch(`/api/v1/finance/transactions${query ? `?${query}` : ""}`);
    if (!response.ok) throw new Error(await responseError(response, text("requestFailed")));
    const data = await response.json() as { transactions: FinanceTransaction[] };
    setTransactions(data.transactions);
  }, [appliedFilters, text]);

  const exportQuery = transactionQuery(appliedFilters, "csv");
  const exportHref = `/api/v1/finance/transactions?${exportQuery}`;

  const loadAccounts = useCallback(async () => {
    const response = await fetch("/api/v1/finance/accounts");
    if (!response.ok) throw new Error(await responseError(response, text("requestFailed")));
    const data = await response.json() as { accounts: TransactionAccount[] };
    const activeAccounts = data.accounts.filter((account) => account.is_active);
    setAccounts(activeAccounts);
    setAccountId((current) => activeAccounts.some((account) => account.id === current)
      ? current
      : activeAccounts[0]?.id ?? "");
  }, [text]);

  const loadCategories = useCallback(async () => {
    const response = await fetch("/api/v1/finance/categories");
    if (!response.ok) throw new Error(await responseError(response, text("requestFailed")));
    const data = await response.json() as { categories: FinanceCategory[] };
    setCategories(data.categories);
  }, [text]);

  const refreshTransactions = useCallback(() => {
    return loadTransactions().catch((cause: unknown) => {
      setTransactionError(cause instanceof Error ? cause.message : text("requestFailed"));
    });
  }, [loadTransactions, text]);

  useEffect(() => {
    let cancelled = false;
    if (canAccess) {
      loadTransactions().catch((cause: unknown) => {
        if (!cancelled) setTransactionError(cause instanceof Error ? cause.message : text("requestFailed"));
      }).finally(() => {
        if (!cancelled) setTransactionLoading(false);
      });
    }
    if (canCreate) {
      loadAccounts().catch((cause: unknown) => {
        if (!cancelled) setAccountError(cause instanceof Error ? cause.message : text("requestFailed"));
      }).finally(() => {
        if (!cancelled) setAccountsLoading(false);
      });
      loadCategories().catch((cause: unknown) => {
        if (!cancelled) setTransactionError(cause instanceof Error ? cause.message : text("requestFailed"));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [canAccess, canCreate, loadAccounts, loadCategories, loadTransactions, text]);

  useEffect(() => {
    const refreshCategories = () => {
      loadCategories().catch((cause: unknown) => {
        setTransactionError(cause instanceof Error ? cause.message : text("requestFailed"));
      });
    };
    window.addEventListener("finance-categories-updated", refreshCategories);
    return () => window.removeEventListener("finance-categories-updated", refreshCategories);
  }, [loadCategories, text]);

  async function createTransaction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedAccount) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setTransactionError("");
    setNotice("");
    setSaving(true);
    try {
      const response = await fetch("/api/v1/finance/transactions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entityId: selectedAccount.entity_id,
          accountId: selectedAccount.id,
          type: form.get("type"),
          categoryId: String(form.get("categoryId") ?? "") || null,
          date: form.get("date"),
          amount: form.get("amount"),
          description: String(form.get("description") ?? "").trim() || null,
        }),
      });
      if (!response.ok) {
        setTransactionError(await responseError(response, text("requestFailed")));
        return;
      }
      const result = await response.json() as { txNumber: string };
      setNotice(`${text("transactionCreated")} ${result.txNumber}`);
      formElement.reset();
      await loadTransactions();
    } catch (cause) {
      setTransactionError(cause instanceof Error ? cause.message : text("requestFailed"));
    } finally {
      setSaving(false);
    }
  }

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAppliedFilters({ ...filters });
  }

  async function validateTransaction(id: string) {
    setTransactionError("");
    setNotice("");
    try {
      const response = await fetch(`/api/v1/finance/transactions/${id}/validate`, { method: "POST" });
      if (!response.ok) {
        setTransactionError(await responseError(response, text("requestFailed")));
        return;
      }
      setNotice(text("transactionValidated"));
      await refreshTransactions();
    } catch (cause) {
      setTransactionError(cause instanceof Error ? cause.message : text("requestFailed"));
    }
  }

  async function submitForApproval(id: string) {
    setTransactionError("");
    setNotice("");
    setSaving(true);
    try {
      const response = await fetch(`/api/v1/finance/transactions/${id}/submit-approval`, { method: "POST" });
      if (!response.ok) {
        setTransactionError(await responseError(response, text("requestFailed")));
        return;
      }
      setNotice(text("expenseSubmittedForApproval"));
      await refreshTransactions();
    } catch (cause) {
      setTransactionError(cause instanceof Error ? cause.message : text("requestFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function reverseTransaction(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setTransactionError("");
    setNotice("");
    setSaving(true);
    try {
      const response = await fetch(`/api/v1/finance/transactions/${id}/reverse`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ date: form.get("date"), reason: form.get("reason") }),
      });
      if (!response.ok) {
        setTransactionError(await responseError(response, text("requestFailed")));
        return;
      }
      const result = await response.json() as { reversal: { tx_number: string } };
      setNotice(`${text("reversalDraftCreated")} ${result.reversal.tx_number}`);
      setReversingId("");
      await refreshTransactions();
    } catch (cause) {
      setTransactionError(cause instanceof Error ? cause.message : text("requestFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel finance-panel transactions-panel">
      <div className="panel-heading">
        <div><span className="eyebrow">{text("finance").toUpperCase()}</span><h2>{text("transactions")}</h2></div>
        <div className="panel-actions">
          {canAccess && <a className="button button-secondary" href={exportHref}>{text("exportCsv")}</a>}
          <span className="count-pill">{transactions.length}</span>
        </div>
      </div>
      {transactionError && <p className="form-error" role="alert">{transactionError}</p>}
      {notice && <p className="success-message" role="status">{notice}</p>}
      {canCreate ? (
        accountsLoading ? <p className="muted">{text("loading")}</p> : accountError ? <p className="form-error" role="alert">{accountError}</p>
          : accounts.length ? (
            <>
              <details className="mobile-quick-expense">
                <summary>{text("quickExpense")}</summary>
                <form className="stack-form transaction-form" onSubmit={createTransaction}>
                  <input type="hidden" name="type" value="expense" />
                  <label>{text("transactionAccount")}<select value={accountId} onChange={(event) => setAccountId(event.target.value)} required>
                    {accounts.map((account) => <option key={account.id} value={account.id}>
                      {account.entity_name} · {account.name} ({account.currency})
                    </option>)}
                  </select></label>
                  <label>{text("financeCategories")}<select key={`${selectedAccount?.entity_id}-quick-expense`} name="categoryId" defaultValue="">
                    <option value="">{quickExpenseCategories.length ? text("selectCategory") : text("noCategories")}</option>
                    {quickExpenseCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                  </select></label>
                  <label>{text("transactionDate")}<input name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label>
                  <label>{text("amount")}<input name="amount" type="number" min="0.01" step="0.01" required /></label>
                  <label>{text("description")}<textarea name="description" maxLength={1000} rows={2} /></label>
                  <button className="button button-primary" type="submit" disabled={!selectedAccount || saving}>
                    {saving ? text("saving") : text("createTransaction")}
                  </button>
                </form>
              </details>
              <form className="stack-form transaction-form" onSubmit={createTransaction}>
              <label>{text("transactionAccount")}<select value={accountId} onChange={(event) => setAccountId(event.target.value)} required>
                {accounts.map((account) => <option key={account.id} value={account.id}>
                  {account.entity_name} · {account.name} ({account.currency})
                </option>)}
              </select></label>
              <label>{text("transactionType")}<select name="type" value={transactionType} onChange={(event) => {
                if (event.target.value === "income" || event.target.value === "expense") {
                  setTransactionType(event.target.value);
                }
              }}>
                <option value="expense">{text("transactionExpense")}</option>
                <option value="income">{text("transactionIncome")}</option>
              </select></label>
              <label>{text("financeCategories")}<select key={`${selectedAccount?.entity_id}-${transactionType}`} name="categoryId" defaultValue="">
                <option value="">{availableCategories.length ? text("selectCategory") : text("noCategories")}</option>
                {availableCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select></label>
              <label>{text("transactionDate")}<input name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label>
              <label>{text("amount")}<input name="amount" type="number" min="0.01" step="0.01" required /></label>
              <label>{text("description")}<textarea name="description" maxLength={1000} rows={2} /></label>
              <button className="button button-primary" type="submit" disabled={!selectedAccount || saving}>
                {saving ? text("saving") : text("createTransaction")}
              </button>
              </form>
            </>
          ) : <p className="empty-state">{text("noActiveAccounts")}</p>
      ) : null}
      {canAccess && (
        <form className="transaction-filters" onSubmit={applyFilters}>
          <label>{text("fromDate")}<input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></label>
          <label>{text("toDate")}<input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} /></label>
          <label>{text("transactionType")}<select value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value })}>
            <option value="">{text("allTransactionTypes")}</option>
            {(["income", "expense", "transfer_in", "transfer_out", "adjustment"] as const).map((type) => (
              <option key={type} value={type}>{text(transactionTypeKey(type))}</option>
            ))}
          </select></label>
          <label>{text("state")}<select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
            <option value="">{text("allTransactionStatuses")}</option>
            {(["draft", "pending_approval", "validated", "rejected", "reversed"] as const).map((status) => (
              <option key={status} value={status}>{text(transactionStatusKey(status))}</option>
            ))}
          </select></label>
          <label>{text("searchTransactions")}<input type="search" maxLength={120} value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} /></label>
          <button className="button button-secondary" type="submit">{text("applyFilters")}</button>
        </form>
      )}
      {transactionLoading ? <p className="muted">{text("loading")}</p> : transactions.length ? (
        <div className="table-scroll transaction-table">
          <table>
            <thead><tr><th>{text("transactionNumber")}</th><th>{text("transactionDate")}</th><th>{text("transactionType")}</th><th>{text("transactionAccount")}</th><th>{text("financeCategories")}</th><th>{text("amount")}</th><th>{text("state")}</th><th /></tr></thead>
            <tbody>{transactions.map((transaction) => (
              <Fragment key={transaction.id}>
                <tr>
                  <td><strong>{transaction.tx_number}</strong><span className="table-sub">{transaction.description ?? transaction.entity_name}</span></td>
                  <td>{transaction.tx_date}</td>
                  <td>{text(transactionTypeKey(transaction.tx_type))}</td>
                  <td>{transaction.account_name}</td>
                  <td>{transaction.category_name ?? "—"}</td>
                  <td>{formatMoney(transaction.amount, transaction.currency, locale)}</td>
                  <td>{text(transactionStatusKey(transaction.status))}</td>
                  <td>
                    {transaction.canSubmitApproval && <button className="table-action" type="button" disabled={saving} onClick={() => void submitForApproval(transaction.id)}>{text("submitForApproval")}</button>}
                    {transaction.canValidate && <button className="table-action" type="button" onClick={() => void validateTransaction(transaction.id)}>{text("validateTransaction")}</button>}
                    {transaction.canReverse && (reversingId === transaction.id
                      ? <button className="table-action" type="button" onClick={() => setReversingId("")}>{text("cancel")}</button>
                      : <button className="table-action" type="button" onClick={() => setReversingId(transaction.id)}>{text("reverseTransaction")}</button>)}
                  </td>
                </tr>
                {reversingId === transaction.id && (
                  <tr key={`${transaction.id}-reversal`}>
                    <td colSpan={8}>
                      <form className="stack-form transaction-form" onSubmit={(event) => void reverseTransaction(event, transaction.id)}>
                        <label>{text("transactionDate")}<input name="date" type="date" required /></label>
                        <label>{text("reversalReason")}<textarea name="reason" minLength={3} maxLength={500} required rows={2} /></label>
                        <button className="button button-primary" type="submit" disabled={saving}>{saving ? text("saving") : text("reverseTransaction")}</button>
                      </form>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}</tbody>
          </table>
        </div>
      ) : !transactionLoading && canAccess ? <p className="empty-state">{text("noTransactions")}</p> : null}
    </section>
  );
}

function transactionStatusKey(status: FinanceTransaction["status"]): Parameters<typeof translate>[1] {
  if (status === "validated") return "transactionValidatedStatus";
  if (status === "pending_approval") return "transactionPending";
  if (status === "rejected") return "transactionRejected";
  if (status === "reversed") return "transactionReversed";
  return "transactionDraft";
}

function transactionTypeKey(type: FinanceTransaction["tx_type"]): Parameters<typeof translate>[1] {
  if (type === "income") return "transactionIncome";
  if (type === "transfer_in") return "transferIn";
  if (type === "transfer_out") return "transferOut";
  return "transactionExpense";
}
