"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Locale } from "@/lib/auth";
import { translate } from "@/lib/i18n";
import { formatMoney } from "@/lib/money.mjs";

type BudgetScope = "global" | "department" | "project" | "category" | "marketing" | "operations" | "hr";
type PeriodType = "annual" | "monthly";

interface Entity { id: string; name: string }
interface Department extends Entity { code: string }
interface EntityOption extends Entity { entity_id: string }
interface CategoryOption { id: string; entity_id: string | null; name: string }
interface BudgetLine {
  id: string;
  budget_id: string;
  category_id: string | null;
  category_name: string | null;
  label: string | null;
  planned_amount: string;
}
interface Budget {
  id: string;
  entity_id: string;
  entity_name: string;
  name: string;
  fiscal_year: number;
  period_type: PeriodType;
  period_month: number | null;
  scope: BudgetScope;
  department_id: string | null;
  department_name: string | null;
  project_id: string | null;
  project_name: string | null;
  currency: "HTG" | "USD";
  status: "draft" | "pending_approval" | "approved" | "rejected" | "closed";
  canSubmitApproval: boolean;
  alert_threshold_pct: string;
  planned_amount: string;
  actual_amount: string | null;
  threshold_reached: boolean;
  missing_rate_count: string;
  lines: BudgetLine[];
}
interface BudgetData {
  budgets: Budget[];
  entities: Entity[];
  manageableEntityIds: string[];
  departments: Department[];
  projects: EntityOption[];
  categories: CategoryOption[];
}
interface ApiError { error?: string }
interface DraftLine { categoryId: string; label: string; plannedAmount: string }

export function FinanceBudgetsManager({
  locale,
  canRead,
  canManage,
}: {
  locale: Locale;
  canRead: boolean;
  canManage: boolean;
}) {
  const text = useCallback((key: Parameters<typeof translate>[1]) => translate(locale, key), [locale]);
  const [data, setData] = useState<BudgetData>({
    budgets: [], entities: [], manageableEntityIds: [], departments: [], projects: [], categories: [],
  });
  const [entityId, setEntityId] = useState("");
  const [editingBudgetId, setEditingBudgetId] = useState("");
  const [budgetName, setBudgetName] = useState("");
  const [fiscalYear, setFiscalYear] = useState(String(new Date().getFullYear()));
  const [scope, setScope] = useState<BudgetScope>("global");
  const [periodType, setPeriodType] = useState<PeriodType>("annual");
  const [periodMonth, setPeriodMonth] = useState(String(new Date().getMonth() + 1));
  const [departmentId, setDepartmentId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [budgetCurrency, setBudgetCurrency] = useState<"HTG" | "USD">("HTG");
  const [alertThresholdPct, setAlertThresholdPct] = useState("90");
  const [lines, setLines] = useState<DraftLine[]>([{ categoryId: "", label: "", plannedAmount: "" }]);
  const [loading, setLoading] = useState(canRead);
  const [saving, setSaving] = useState(false);
  const [savingBudgetId, setSavingBudgetId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/v1/finance/budgets");
    const body = await response.json() as BudgetData & ApiError;
    if (!response.ok) throw new Error(body.error ?? text("requestFailed"));
    setData(body);
    setEntityId((current) => body.manageableEntityIds.includes(current)
      ? current
      : body.manageableEntityIds[0] ?? "");
  }, [text]);

  useEffect(() => {
    let cancelled = false;
    if (canRead) {
      load().catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : text("requestFailed"));
      }).finally(() => {
        if (!cancelled) setLoading(false);
      });
    }
    return () => { cancelled = true; };
  }, [canRead, load, text]);

  const entityCategories = data.categories.filter((category) => category.entity_id === null || category.entity_id === entityId);
  const entityDepartments = data.departments;
  const entityProjects = data.projects.filter((project) => project.entity_id === entityId);
  const manageableEntities = data.entities.filter((entity) => data.manageableEntityIds.includes(entity.id));

  function updateLine(index: number, field: keyof DraftLine, value: string) {
    setLines((current) => current.map((line, lineIndex) =>
      lineIndex === index ? { ...line, [field]: value } : line,
    ));
  }

  async function createBudget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setSaving(true);
    try {
      const response = await fetch(
        editingBudgetId ? `/api/v1/finance/budgets/${editingBudgetId}` : "/api/v1/finance/budgets",
        {
          method: editingBudgetId ? "PUT" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            entityId,
            name: budgetName,
            fiscalYear: Number(fiscalYear),
            periodType,
            periodMonth: periodType === "monthly" ? Number(periodMonth) : null,
            scope,
            departmentId: scope === "department" ? departmentId : null,
            projectId: scope === "project" ? projectId : null,
            currency: budgetCurrency,
            alertThresholdPct,
            lines: lines.map((line) => ({
              categoryId: line.categoryId || null,
              label: line.label.trim() || null,
              plannedAmount: line.plannedAmount,
            })),
          }),
        },
      );
      const body = await response.json() as ApiError;
      if (!response.ok) {
        setError(body.error ?? text("requestFailed"));
        return;
      }
      const wasEditing = Boolean(editingBudgetId);
      setEditingBudgetId("");
      setBudgetName("");
      setFiscalYear(String(new Date().getFullYear()));
      setPeriodType("annual");
      setScope("global");
      setPeriodMonth(String(new Date().getMonth() + 1));
      setDepartmentId("");
      setProjectId("");
      setBudgetCurrency("HTG");
      setAlertThresholdPct("90");
      setLines([{ categoryId: "", label: "", plannedAmount: "" }]);
      setNotice(text(wasEditing ? "budgetUpdated" : "budgetCreated"));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text("requestFailed"));
    } finally {
      setSaving(false);
    }
  }

  function editBudget(budget: Budget) {
    setEditingBudgetId(budget.id);
    setEntityId(budget.entity_id);
    setBudgetName(budget.name);
    setFiscalYear(String(budget.fiscal_year));
    setPeriodType(budget.period_type);
    setPeriodMonth(String(budget.period_month ?? new Date().getMonth() + 1));
    setScope(budget.scope);
    setDepartmentId(budget.department_id ?? "");
    setProjectId(budget.project_id ?? "");
    setBudgetCurrency(budget.currency);
    setAlertThresholdPct(budget.alert_threshold_pct);
    setLines(budget.lines.map((line) => ({
      categoryId: line.category_id ?? "",
      label: line.label ?? "",
      plannedAmount: line.planned_amount,
    })));
    setError("");
    setNotice("");
  }

  function cancelBudgetEdit() {
    setEditingBudgetId("");
    setBudgetName("");
    setFiscalYear(String(new Date().getFullYear()));
    setPeriodType("annual");
    setPeriodMonth(String(new Date().getMonth() + 1));
    setScope("global");
    setDepartmentId("");
    setProjectId("");
    setBudgetCurrency("HTG");
    setAlertThresholdPct("90");
    setLines([{ categoryId: "", label: "", plannedAmount: "" }]);
  }

  async function submitBudget(budgetId: string) {
    setError("");
    setNotice("");
    setSavingBudgetId(budgetId);
    try {
      const response = await fetch(`/api/v1/finance/budgets/${budgetId}/submit-approval`, { method: "POST" });
      const body = await response.json() as ApiError;
      if (!response.ok) {
        setError(body.error ?? text("requestFailed"));
        return;
      }
      setNotice(text("budgetSubmitted"));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text("requestFailed"));
    } finally {
      setSavingBudgetId("");
    }
  }

  function formatAmount(amount: string, currency: "HTG" | "USD") {
    return formatMoney(amount, currency, locale);
  }

  function formatPeriod(budget: Budget) {
    if (budget.period_type === "annual" || budget.period_month === null) return String(budget.fiscal_year);
    const month = new Intl.DateTimeFormat(locale === "ht" ? "ht-HT" : locale, {
      month: "long",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(budget.fiscal_year, budget.period_month - 1, 1)));
    return `${month} ${budget.fiscal_year}`;
  }

  function formatScope(budget: Budget) {
    if (budget.scope === "department") return `${text("budgetScopeDepartment")}: ${budget.department_name ?? "—"}`;
    if (budget.scope === "project") return `${text("budgetScopeProject")}: ${budget.project_name ?? "—"}`;
    if (budget.scope === "marketing" || budget.scope === "operations" || budget.scope === "hr") {
      const labels = {
        marketing: "budgetScopeMarketing",
        operations: "budgetScopeOperations",
        hr: "budgetScopeHr",
      } as const;
      return text(labels[budget.scope]);
    }
    return text(budget.scope === "category" ? "budgetScopeCategory" : "budgetScopeGlobal");
  }

  if (!canRead) return null;

  return (
    <section className="panel finance-panel budget-panel">
      <div className="panel-heading">
        <div><span className="eyebrow">{text("finance").toUpperCase()}</span><h2>{text("budgets")}</h2></div>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="success-message" role="status">{notice}</p>}
      {loading ? <p className="muted">{text("loading")}</p> : (
        <>
          {data.budgets.length ? (
            <div className="table-scroll">
              <table>
                <thead><tr>
                  <th>{text("name")}</th><th>{text("entity")}</th><th>{text("budgetPeriod")}</th>
                  <th>{text("budgetScope")}</th><th>{text("budgetPlanned")}</th>
                  <th>{text("budgetActual")}</th><th>{text("state")}</th>
                </tr></thead>
                <tbody>{data.budgets.map((budget) => {
                  const missingRates = Number(budget.missing_rate_count) > 0;
                  const alert = budget.threshold_reached;
                  return (
                    <tr key={budget.id}>
                      <td><strong>{budget.name}</strong><span className="table-sub">
                        {budget.lines.map((line) => {
                          const label = line.category_name ?? line.label ?? "—";
                          return `${label}: ${formatAmount(line.planned_amount, budget.currency)}`;
                        }).join(", ")}
                      </span>
                        {missingRates && <span className="budget-warning">{text("budgetMissingRates")}</span>}
                      </td>
                      <td>{budget.entity_name}</td>
                      <td>{formatPeriod(budget)}</td>
                      <td>{formatScope(budget)}</td>
                      <td>{formatAmount(budget.planned_amount, budget.currency)}</td>
                      <td className={alert ? "budget-alert" : undefined}>
                        {budget.actual_amount === null ? "—" : formatAmount(budget.actual_amount, budget.currency)}
                        {alert && !missingRates && <span className="table-sub">{text("budgetThresholdReached")}</span>}
                      </td>
                      <td>
                        {text(budget.status === "pending_approval" ? "budgetPendingApproval" : `budgetStatus${budget.status[0].toUpperCase()}${budget.status.slice(1)}` as Parameters<typeof translate>[1])}
                        {budget.canSubmitApproval && <button className="table-action" type="button"
                          onClick={() => editBudget(budget)}>
                          {text("editBudget")}
                        </button>}
                        {budget.canSubmitApproval && <button className="table-action" type="button"
                          disabled={savingBudgetId === budget.id}
                          onClick={() => void submitBudget(budget.id)}>
                          {savingBudgetId === budget.id ? text("saving") : text("submitForApproval")}
                        </button>}
                      </td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          ) : <p className="empty-state">{text("noBudgets")}</p>}

          {canManage && (
            <form className="stack-form budget-form" onSubmit={(event) => void createBudget(event)}>
              <h3>{text(editingBudgetId ? "editBudget" : "createBudget")}</h3>
              <div className="budget-fields">
                <label>{text("entity")}<select value={entityId} onChange={(event) => setEntityId(event.target.value)} required disabled={Boolean(editingBudgetId)}>
                  {manageableEntities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)}
                </select></label>
                <label>{text("name")}<input value={budgetName} onChange={(event) => setBudgetName(event.target.value)} required minLength={2} maxLength={120} /></label>
                <label>{text("budgetYear")}<input value={fiscalYear} onChange={(event) => setFiscalYear(event.target.value)} type="number" min="2000" max="2200" required /></label>
                <label>{text("budgetPeriodType")}<select value={periodType} onChange={(event) => setPeriodType(event.target.value as PeriodType)}>
                  <option value="annual">{text("budgetAnnual")}</option>
                  <option value="monthly">{text("budgetMonthly")}</option>
                </select></label>
                {periodType === "monthly" && <label>{text("month")}<select value={periodMonth} onChange={(event) => setPeriodMonth(event.target.value)}>
                  {Array.from({ length: 12 }, (_, index) => (
                    <option key={index + 1} value={index + 1}>
                      {new Intl.DateTimeFormat(locale === "ht" ? "ht-HT" : locale, { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, index, 1)))}
                    </option>
                  ))}
                </select></label>}
                <label>{text("budgetScope")}<select value={scope} onChange={(event) => setScope(event.target.value as BudgetScope)}>
                  <option value="global">{text("budgetScopeGlobal")}</option>
                  <option value="department">{text("budgetScopeDepartment")}</option>
                  <option value="project">{text("budgetScopeProject")}</option>
                  <option value="category">{text("budgetScopeCategory")}</option>
                  {entityDepartments.some(({ code }) => code === "MKT") && <option value="marketing">{text("budgetScopeMarketing")}</option>}
                  {entityDepartments.some(({ code }) => code === "OPS") && <option value="operations">{text("budgetScopeOperations")}</option>}
                  {entityDepartments.some(({ code }) => code === "DRH") && <option value="hr">{text("budgetScopeHr")}</option>}
                </select></label>
                {scope === "department" && <label>{text("department")}<select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} required>
                  {entityDepartments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                </select></label>}
                {scope === "project" && <label>{text("projects")}<select value={projectId} onChange={(event) => setProjectId(event.target.value)} required>
                  {entityProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select></label>}
                <label>{text("currency")}<select value={budgetCurrency} onChange={(event) => setBudgetCurrency(event.target.value as "HTG" | "USD")}>
                  <option value="HTG">HTG</option><option value="USD">USD</option>
                </select></label>
                <label>{text("budgetAlertThreshold")}<input value={alertThresholdPct} onChange={(event) => setAlertThresholdPct(event.target.value)} type="number" min="0.01" max="999.99" step="0.01" required /></label>
              </div>
              <div className="budget-lines">
                <div className="budget-lines-heading"><h4>{text("budgetLines")}</h4>
                  <button className="table-action" type="button" onClick={() => setLines((current) => [...current, { categoryId: "", label: "", plannedAmount: "" }])}>
                    {text("addBudgetLine")}
                  </button>
                </div>
                {lines.map((line, index) => (
                  <div className="budget-line" key={index}>
                    <label>{text("selectCategory")}<select value={line.categoryId} required={scope === "category"} onChange={(event) => updateLine(index, "categoryId", event.target.value)}>
                      <option value="">{text("budgetNoCategory")}</option>
                      {entityCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                    </select></label>
                    <label>{text("budgetLineLabel")}<input value={line.label} maxLength={120} onChange={(event) => updateLine(index, "label", event.target.value)} /></label>
                    <label>{text("budgetPlanned")}<input type="number" min="0" step="0.01" value={line.plannedAmount} required onChange={(event) => updateLine(index, "plannedAmount", event.target.value)} /></label>
                    {lines.length > 1 && <button className="table-action budget-remove-line" type="button" onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}>
                      {text("removeBudgetLine")}
                    </button>}
                  </div>
                ))}
              </div>
              <button className="button button-primary" type="submit" disabled={saving || !entityId || (scope === "department" && entityDepartments.length === 0) || (scope === "project" && entityProjects.length === 0)}>
                {saving ? text("saving") : text(editingBudgetId ? "saveBudgetChanges" : "createBudget")}
              </button>
              {editingBudgetId && <button className="button button-secondary" type="button" onClick={cancelBudgetEdit}>
                {text("cancel")}
              </button>}
            </form>
          )}
        </>
      )}
    </section>
  );
}
