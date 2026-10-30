"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Locale } from "@/lib/auth";
import { translate } from "@/lib/i18n";

interface FinanceEntity {
  id: string;
  name: string;
}

interface FinanceCategory {
  id: string;
  entity_id: string;
  code: string;
  name: string;
  kind: "income" | "expense";
  parent_id: string | null;
  parent_name: string | null;
  is_active: boolean;
}

interface ApiError { error?: string }

export function FinanceCategoriesManager({
  locale,
  canManage,
}: {
  locale: Locale;
  canManage: boolean;
}) {
  const text = useCallback((key: Parameters<typeof translate>[1]) => translate(locale, key), [locale]);
  const [entities, setEntities] = useState<FinanceEntity[]>([]);
  const [categories, setCategories] = useState<FinanceCategory[]>([]);
  const [entityId, setEntityId] = useState("");
  const [categoryKind, setCategoryKind] = useState<"income" | "expense">("expense");
  const [loading, setLoading] = useState(canManage);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [accountsResponse, categoriesResponse] = await Promise.all([
      fetch("/api/v1/finance/accounts"),
      fetch("/api/v1/finance/categories"),
    ]);
    if (!accountsResponse.ok || !categoriesResponse.ok) {
      const response = !accountsResponse.ok ? accountsResponse : categoriesResponse;
      const body = await response.json().catch(() => null) as ApiError | null;
      throw new Error(body?.error ?? text("requestFailed"));
    }
    const [accountData, categoryData] = await Promise.all([
      accountsResponse.json() as Promise<{ entities: FinanceEntity[] }>,
      categoriesResponse.json() as Promise<{ categories: FinanceCategory[] }>,
    ]);
    setEntities(accountData.entities);
    setEntityId((current) => current || accountData.entities[0]?.id || "");
    setCategories(categoryData.categories.filter((category) => category.entity_id !== null));
  }, [text]);

  useEffect(() => {
    let cancelled = false;
    if (canManage) {
      load().catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : text("requestFailed"));
      }).finally(() => {
        if (!cancelled) setLoading(false);
      });
    }
    return () => { cancelled = true; };
  }, [canManage, load, text]);

  async function createCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setError("");
    setNotice("");
    setSaving(true);
    try {
      const response = await fetch("/api/v1/finance/categories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entityId,
          code: form.get("code"),
          name: form.get("name"),
          kind: form.get("kind"),
        }),
      });
      const body = await response.json() as ApiError;
      if (!response.ok) {
        setError(body.error ?? text("requestFailed"));
        return;
      }
      formElement.reset();
      setNotice(text("categoryCreated"));
      await load();
      window.dispatchEvent(new Event("finance-categories-updated"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text("requestFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function deactivateCategory(category: FinanceCategory) {
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/v1/finance/categories", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: category.id, name: category.name, isActive: false }),
      });
      const body = await response.json() as ApiError;
      if (!response.ok) {
        setError(body.error ?? text("requestFailed"));
        return;
      }
      setNotice(text("categoryDeactivated"));
      await load();
      window.dispatchEvent(new Event("finance-categories-updated"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text("requestFailed"));
    }
  }

  if (!canManage) return null;

  return (
    <section className="panel finance-panel category-panel">
      <div className="panel-heading">
        <div><span className="eyebrow">{text("finance").toUpperCase()}</span><h2>{text("financeCategories")}</h2></div>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="success-message" role="status">{notice}</p>}
      {loading ? <p className="muted">{text("loading")}</p> : (
        <>
          <div className="table-scroll">
            <table>
              <thead><tr><th>{text("name")}</th><th>{text("entity")}</th><th>{text("transactionType")}</th><th /></tr></thead>
              <tbody>{categories.map((category) => (
                <tr key={category.id}>
                          <td><strong>{category.name}</strong><span className="table-sub">{category.parent_name ? `${text("parentCategory")}: ${category.parent_name}` : category.code}</span></td>
                  <td>{entities.find((entity) => entity.id === category.entity_id)?.name ?? "—"}</td>
                  <td>{text(category.kind === "income" ? "transactionIncome" : "transactionExpense")}</td>
                  <td><button className="table-action" type="button" onClick={() => void deactivateCategory(category)}>{text("deactivateCategory")}</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {entities.length ? (
            <form className="stack-form finance-form category-form" onSubmit={(event) => void createCategory(event)}>
              <label>{text("entity")}<select value={entityId} onChange={(event) => setEntityId(event.target.value)} required>
                {entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
              </select></label>
              <label>{text("categoryCode")}<input name="code" required minLength={2} maxLength={40} pattern="(?:[A-Za-z0-9_]|-)+" /></label>
              <label>{text("name")}<input name="name" required minLength={2} maxLength={120} /></label>
              <label>{text("transactionType")}<select name="kind" defaultValue="expense" onChange={(event) => setCategoryKind(event.target.value === "income" ? "income" : "expense")}>
                <option value="expense">{text("transactionExpense")}</option>
                <option value="income">{text("transactionIncome")}</option>
              </select></label>
              <label>{text("parentCategory")}<select key={`${entityId}-${categoryKind}`} name="parentId" defaultValue="">
                <option value="">{text("noParentCategory")}</option>
                {categories.filter((category) => category.entity_id === entityId && category.kind === categoryKind).map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select></label>
              <button className="button button-primary" type="submit" disabled={saving || !entityId}>
                {saving ? text("saving") : text("createCategory")}
              </button>
            </form>
          ) : <p className="empty-state">{text("noManageableEntities")}</p>}
        </>
      )}
    </section>
  );
}
