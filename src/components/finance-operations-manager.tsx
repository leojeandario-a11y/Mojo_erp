"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { Locale } from "@/lib/auth";
import { translate } from "@/lib/i18n";
import { formatMoney } from "@/lib/money.mjs";

interface FinanceAccount {
  id: string;
  entity_id: string;
  entity_name: string;
  name: string;
  currency: "HTG" | "USD";
  account_type: "cash" | "bank" | "mobile_money" | "other";
  is_active: boolean;
}

interface FinanceCategory {
  id: string;
  entity_id: string | null;
  name: string;
  kind: "income" | "expense";
}

interface FinancePayment {
  id: string;
  entity_id: string;
  entity_name: string;
  direction: "in" | "out";
  payee: string;
  amount: string;
  currency: "HTG" | "USD";
  method: string;
  paid_at: string;
  reference: string | null;
  tx_number: string | null;
  status: string | null;
}

interface FinanceDebt {
  id: string;
  entity_id: string;
  entity_name: string;
  creditor: string;
  description: string | null;
  principal: string;
  currency: "HTG" | "USD";
  incurred_on: string;
  due_date: string | null;
  paid_amount: string;
  balance_due: string;
  status: "open" | "partially_paid" | "paid" | "cancelled";
}

interface ApiError { error?: string }

function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function FinanceOperationsManager({
  locale,
  canAccess,
  canCreate,
}: {
  locale: Locale;
  canAccess: boolean;
  canCreate: boolean;
}) {
  const text = useCallback((key: Parameters<typeof translate>[1]) => translate(locale, key), [locale]);
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [categories, setCategories] = useState<FinanceCategory[]>([]);
  const [payments, setPayments] = useState<FinancePayment[]>([]);
  const [debts, setDebts] = useState<FinanceDebt[]>([]);
  const [loading, setLoading] = useState(canAccess);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [paymentDirection, setPaymentDirection] = useState<"in" | "out">("out");
  const [paymentAccountId, setPaymentAccountId] = useState("");
  const [debtEntityId, setDebtEntityId] = useState("");
  const [repayingDebtId, setRepayingDebtId] = useState("");

  const selectedPaymentAccount = accounts.find((account) => account.id === paymentAccountId);
  const selectedEntityCategories = useMemo(
    () => categories.filter((category) =>
      category.kind === (paymentDirection === "in" ? "income" : "expense")
      && (category.entity_id === null || category.entity_id === selectedPaymentAccount?.entity_id),
    ),
    [categories, paymentDirection, selectedPaymentAccount],
  );
  const entities = useMemo(() => {
    const seen = new Set<string>();
    return accounts.filter((account) => {
      if (seen.has(account.entity_id)) return false;
      seen.add(account.entity_id);
      return true;
    });
  }, [accounts]);

  const load = useCallback(async () => {
    const requests = [
      fetch("/api/v1/finance/accounts"),
      fetch("/api/v1/finance/categories"),
      fetch("/api/v1/finance/payments"),
      fetch("/api/v1/finance/debts"),
    ];
    const [accountResponse, categoryResponse, paymentResponse, debtResponse] = await Promise.all(requests);
    for (const response of [accountResponse, categoryResponse, paymentResponse, debtResponse]) {
      if (!response.ok) {
        const body = await response.json().catch(() => null) as ApiError | null;
        throw new Error(body?.error ?? text("requestFailed"));
      }
    }
    const [accountData, categoryData, paymentData, debtData] = await Promise.all([
      accountResponse.json() as Promise<{ accounts: FinanceAccount[] }>,
      categoryResponse.json() as Promise<{ categories: FinanceCategory[] }>,
      paymentResponse.json() as Promise<{ payments: FinancePayment[] }>,
      debtResponse.json() as Promise<{ debts: FinanceDebt[] }>,
    ]);
    const activeAccounts = accountData.accounts.filter((account) => account.is_active);
    setAccounts(activeAccounts);
    setCategories(categoryData.categories);
    setPayments(paymentData.payments);
    setDebts(debtData.debts);
    setPaymentAccountId((current) => activeAccounts.some(({ id }) => id === current)
      ? current
      : activeAccounts[0]?.id ?? "");
    setDebtEntityId((current) => activeAccounts.some(({ entity_id }) => entity_id === current)
      ? current
      : activeAccounts[0]?.entity_id ?? "");
  }, [text]);

  useEffect(() => {
    let cancelled = false;
    if (canAccess) {
      load().catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : text("requestFailed"));
      }).finally(() => {
        if (!cancelled) setLoading(false);
      });
    }
    return () => { cancelled = true; };
  }, [canAccess, load, text]);

  async function submitJson(
    event: FormEvent<HTMLFormElement>,
    url: string,
    payload: Record<string, unknown>,
    successKey: Parameters<typeof translate>[1],
  ) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setError("");
    setNotice("");
    setSaving(true);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => null) as ApiError | null;
      if (!response.ok) {
        setError(body?.error ?? text("requestFailed"));
        return;
      }
      setNotice(text(successKey));
      formElement.reset();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text("requestFailed"));
    } finally {
      setSaving(false);
    }
  }

  function createPayment(event: FormEvent<HTMLFormElement>) {
    const form = new FormData(event.currentTarget);
    if (!selectedPaymentAccount) return;
    return submitJson(event, "/api/v1/finance/payments", {
      entityId: selectedPaymentAccount.entity_id,
      accountId: selectedPaymentAccount.id,
      direction: paymentDirection,
      payee: form.get("payee"),
      amount: form.get("amount"),
      currency: selectedPaymentAccount.currency,
      method: form.get("method"),
      paidAt: form.get("paidAt"),
      reference: String(form.get("reference") ?? "").trim() || null,
      categoryId: String(form.get("categoryId") ?? "") || null,
    }, "paymentRecorded");
  }

  function createDebt(event: FormEvent<HTMLFormElement>) {
    const form = new FormData(event.currentTarget);
    const currency = String(form.get("currency") ?? "USD");
    return submitJson(event, "/api/v1/finance/debts", {
      entityId: debtEntityId,
      creditor: form.get("creditor"),
      description: String(form.get("description") ?? "").trim() || null,
      principal: form.get("principal"),
      currency,
      incurredOn: form.get("incurredOn"),
      dueDate: String(form.get("dueDate") ?? "") || null,
    }, "debtCreated");
  }

  function repayDebt(event: FormEvent<HTMLFormElement>, debt: FinanceDebt) {
    const form = new FormData(event.currentTarget);
    return submitJson(event, `/api/v1/finance/debts/${debt.id}/payments`, {
      accountId: form.get("accountId"),
      amount: form.get("amount"),
      paidAt: form.get("paidAt"),
      method: form.get("method"),
      reference: String(form.get("reference") ?? "").trim() || null,
    }, "debtRepaymentRecorded");
  }

  if (!canAccess) return null;

  return (
    <section className="finance-operations">
      <div className="panel-heading">
        <div><span className="eyebrow">{text("finance").toUpperCase()}</span><h2>{text("paymentsAndDebts")}</h2></div>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="success-message" role="status">{notice}</p>}
      {loading ? <p className="muted">{text("loading")}</p> : (
        <>
          {canCreate && (
            <div className="finance-operations-grid">
              <form className="stack-form finance-operation-form" onSubmit={createPayment}>
                <h3>{text("recordPayment")}</h3>
                <label>{text("paymentDirection")}<select value={paymentDirection} onChange={(event) => {
                  if (event.target.value === "in" || event.target.value === "out") setPaymentDirection(event.target.value);
                }}>
                  <option value="out">{text("paymentOut")}</option>
                  <option value="in">{text("paymentIn")}</option>
                </select></label>
                <label>{text("transactionAccount")}<select value={paymentAccountId} onChange={(event) => setPaymentAccountId(event.target.value)} required>
                  {accounts.map((account) => <option key={account.id} value={account.id}>
                    {account.entity_name} · {account.name} ({account.currency})
                  </option>)}
                </select></label>
                <label>{text("payeeOrPayer")}<input name="payee" required minLength={2} maxLength={160} /></label>
                <label>{text("amount")}<input name="amount" type="number" min="0.01" step="0.01" required /></label>
                <label>{text("financeCategories")}<select name="categoryId" defaultValue="">
                  <option value="">{text("noCategories")}</option>
                  {selectedEntityCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select></label>
                <label>{text("paymentMethod")}<select name="method" defaultValue="bank_transfer">
                  <option value="cash">{text("paymentMethodCash")}</option>
                  <option value="bank_transfer">{text("paymentMethodBank")}</option>
                  <option value="cheque">{text("paymentMethodCheque")}</option>
                  <option value="mobile_money">{text("paymentMethodMobile")}</option>
                  <option value="card">{text("paymentMethodCard")}</option>
                </select></label>
                <label>{text("paymentDate")}<input name="paidAt" type="date" required defaultValue={localDate()} /></label>
                <label>{text("reference")}<input name="reference" maxLength={160} /></label>
                <button className="button button-primary" type="submit" disabled={saving || !selectedPaymentAccount}>
                  {saving ? text("saving") : text("recordPayment")}
                </button>
              </form>

              <form className="stack-form finance-operation-form" onSubmit={createDebt}>
                <h3>{text("registerDebt")}</h3>
                <label>{text("entity")}<select value={debtEntityId} onChange={(event) => setDebtEntityId(event.target.value)} required>
                  {entities.map((entity) => <option key={entity.entity_id} value={entity.entity_id}>{entity.entity_name}</option>)}
                </select></label>
                <label>{text("creditor")}<input name="creditor" required minLength={2} maxLength={160} /></label>
                <label>{text("description")}<textarea name="description" rows={2} maxLength={1000} /></label>
                <label>{text("amount")}<input name="principal" type="number" min="0.01" step="0.01" required /></label>
                <label>{text("currency")}<select name="currency" defaultValue="USD">
                  <option value="USD">USD</option><option value="HTG">HTG</option>
                </select></label>
                <label>{text("debtIncurredDate")}<input name="incurredOn" type="date" required defaultValue={localDate()} /></label>
                <label>{text("dueDate")}<input name="dueDate" type="date" /></label>
                <button className="button button-primary" type="submit" disabled={saving || !debtEntityId}>
                  {saving ? text("saving") : text("registerDebt")}
                </button>
              </form>
            </div>
          )}

          <h3 className="finance-subheading">{text("paymentsHistory")}</h3>
          {payments.length ? (
            <div className="table-scroll">
              <table>
                <thead><tr><th>{text("paymentDate")}</th><th>{text("entity")}</th><th>{text("paymentDirection")}</th><th>{text("payeeOrPayer")}</th><th>{text("amount")}</th><th>{text("paymentMethod")}</th><th>{text("state")}</th></tr></thead>
                <tbody>{payments.map((payment) => (
                  <tr key={payment.id}>
                    <td>{payment.paid_at}</td><td>{payment.entity_name}</td>
                    <td>{text(payment.direction === "in" ? "paymentIn" : "paymentOut")}</td>
                    <td>{payment.payee}<span className="table-sub">{payment.tx_number ?? payment.reference ?? ""}</span></td>
                    <td>{formatMoney(payment.amount, payment.currency, locale)}</td>
                    <td>{text(paymentMethodKey(payment.method))}</td>
                    <td>{payment.status ? text(transactionStatusKey(payment.status)) : "—"}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <p className="empty-state">{text("noPayments")}</p>}

          <h3 className="finance-subheading">{text("debts")}</h3>
          {debts.length ? (
            <div className="table-scroll">
              <table>
                <thead><tr><th>{text("creditor")}</th><th>{text("entity")}</th><th>{text("amount")}</th><th>{text("paidAmount")}</th><th>{text("balanceDue")}</th><th>{text("state")}</th><th /></tr></thead>
                <tbody>{debts.map((debt) => (
                  <tr key={debt.id}>
                    <td><strong>{debt.creditor}</strong><span className="table-sub">{debt.description ?? debt.incurred_on}</span></td>
                    <td>{debt.entity_name}</td>
                    <td>{formatMoney(debt.principal, debt.currency, locale)}</td>
                    <td>{formatMoney(debt.paid_amount, debt.currency, locale)}</td>
                    <td>{formatMoney(debt.balance_due, debt.currency, locale)}</td>
                    <td>{text(debtStatusKey(debt.status))}</td>
                    <td>{canCreate && Number(debt.balance_due) > 0 && debt.status !== "cancelled"
                      ? <button className="table-action" type="button" onClick={() => setRepayingDebtId((current) => current === debt.id ? "" : debt.id)}>
                        {text(repayingDebtId === debt.id ? "cancel" : "recordRepayment")}
                      </button>
                      : null}</td>
                  </tr>
                )).flatMap((row, index) => {
                  const debt = debts[index];
                  if (!debt || repayingDebtId !== debt.id) return [row];
                  const repaymentAccounts = accounts.filter((account) =>
                    account.entity_id === debt.entity_id && account.currency === debt.currency,
                  );
                  return [
                    row,
                    <tr key={`${debt.id}-repayment`}><td colSpan={7}>
                      {repaymentAccounts.length ? (
                        <form className="stack-form debt-repayment-form" onSubmit={(event) => void repayDebt(event, debt)}>
                          <label>{text("transactionAccount")}<select name="accountId" required>
                            {repaymentAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                          </select></label>
                          <label>{text("amount")}<input name="amount" type="number" min="0.01" max={debt.balance_due} step="0.01" required /></label>
                          <label>{text("paymentDate")}<input name="paidAt" type="date" required defaultValue={localDate()} /></label>
                          <label>{text("paymentMethod")}<select name="method" defaultValue="bank_transfer">
                            <option value="cash">{text("paymentMethodCash")}</option><option value="bank_transfer">{text("paymentMethodBank")}</option>
                            <option value="cheque">{text("paymentMethodCheque")}</option><option value="mobile_money">{text("paymentMethodMobile")}</option>
                            <option value="card">{text("paymentMethodCard")}</option>
                          </select></label>
                          <label>{text("reference")}<input name="reference" maxLength={160} /></label>
                          <button className="button button-primary" type="submit" disabled={saving || !repaymentAccounts.length}>
                            {saving ? text("saving") : text("recordRepayment")}
                          </button>
                        </form>
                      ) : <p className="muted">{text("noMatchingRepaymentAccount")}</p>}
                    </td></tr>,
                  ];
                })}</tbody>
              </table>
            </div>
          ) : <p className="empty-state">{text("noDebts")}</p>}
        </>
      )}
    </section>
  );
}

function transactionStatusKey(status: string): Parameters<typeof translate>[1] {
  if (status === "validated") return "transactionValidatedStatus";
  if (status === "pending_approval") return "transactionPending";
  if (status === "rejected") return "transactionRejected";
  if (status === "reversed") return "transactionReversed";
  return "transactionDraft";
}

function paymentMethodKey(method: string): Parameters<typeof translate>[1] {
  if (method === "cash") return "paymentMethodCash";
  if (method === "bank_transfer") return "paymentMethodBank";
  if (method === "cheque") return "paymentMethodCheque";
  if (method === "mobile_money") return "paymentMethodMobile";
  return "paymentMethodCard";
}

function debtStatusKey(status: FinanceDebt["status"]): Parameters<typeof translate>[1] {
  if (status === "partially_paid") return "debtPartiallyPaid";
  if (status === "paid") return "debtPaid";
  if (status === "cancelled") return "transactionRejected";
  return "debtOpen";
}
