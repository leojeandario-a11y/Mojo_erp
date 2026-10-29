import { getSession, hasPermission } from "@/lib/auth";
import { withDbUser } from "@/lib/db";
import { translate } from "@/lib/i18n";

interface TrendRow {
  month: string;
  income_usd: string;
  expense_usd: string;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ months?: string }>;
}) {
  const user = await getSession();
  if (!user) return null;
  const params = await searchParams;
  const requestedMonths = Number(params.months);
  const months = [1, 3, 6, 12].includes(requestedMonths) ? requestedMonths : 6;
  const globalDashboard = hasPermission(user, "dashboard.global.read");
  const financePermission = "finance.transaction.read";
  const scopedFinanceEntities = Object.entries(user.entityPermissions)
    .filter(([, permissions]) => permissions.includes(financePermission) || permissions.includes("*"))
    .map(([entityId]) => entityId);
  const canReadFinance = hasPermission(user, financePermission) || scopedFinanceEntities.length > 0;
  const approvalEntities = Object.entries(user.entityPermissions)
    .filter(([, permissions]) => permissions.includes("approvals.approve") || permissions.includes("*"))
    .map(([entityId]) => entityId);

  const metrics = await withDbUser(user.id, null, async (client) => {
    let departmentId: string | null = null;
    if (!globalDashboard && hasPermission(user, "dashboard.department.read")) {
      const department = await client.query<{ department_id: string | null }>(
        "SELECT department_id FROM users WHERE id = $1",
        [user.id],
      );
      departmentId = department.rows[0]?.department_id ?? null;
    }
    const userCount = globalDashboard
      ? await client.query<{ count: string }>("SELECT count(*)::text AS count FROM users WHERE is_active")
      : departmentId
        ? await client.query<{ count: string }>("SELECT count(*)::text AS count FROM users WHERE is_active AND department_id = $1", [departmentId])
        : { rows: [{ count: "—" }] };
    const pendingApprovals = hasPermission(user, "approvals.approve")
      ? await client.query<{ count: string }>("SELECT count(*)::text AS count FROM approval_requests WHERE status = 'pending'")
      : approvalEntities.length
        ? await client.query<{ count: string }>(
          `SELECT count(*)::text AS count
           FROM approval_requests ar
           JOIN approval_workflows aw ON aw.id = ar.workflow_id
           WHERE ar.status = 'pending' AND aw.entity_id = ANY($1::uuid[])`,
          [approvalEntities],
        )
        : { rows: [{ count: "—" }] };

    let trend: TrendRow[] = [];
    if (canReadFinance) {
      const entityFilter = hasPermission(user, financePermission)
        ? ""
        : "AND t.entity_id = ANY($2::uuid[])";
      const values = hasPermission(user, financePermission) ? [months] : [months, scopedFinanceEntities];
      const result = await client.query<TrendRow>(
        `WITH period AS (
           SELECT date_trunc('month', current_date) - (n * interval '1 month') AS month_start
           FROM generate_series($1::int - 1, 0, -1) AS n
         )
         SELECT to_char(period.month_start, 'YYYY-MM') AS month,
                COALESCE(sum(t.amount_usd) FILTER (WHERE t.tx_type = 'income'), 0)::text AS income_usd,
                COALESCE(sum(t.amount_usd) FILTER (WHERE t.tx_type = 'expense'), 0)::text AS expense_usd
         FROM period
         LEFT JOIN transactions t ON t.status = 'validated'
           AND t.tx_date >= period.month_start::date
           AND t.tx_date < (period.month_start + interval '1 month')::date
           ${entityFilter}
         GROUP BY period.month_start
         ORDER BY period.month_start`,
        values,
      );
      trend = result.rows;
    }

    const departments = globalDashboard
      ? await client.query<{ name: string; active_users: string }>(
        `SELECT d.name, count(u.id) FILTER (WHERE u.is_active)::text AS active_users
         FROM departments d LEFT JOIN users u ON u.department_id = d.id
         WHERE d.is_active
         GROUP BY d.id
         ORDER BY d.name`,
      )
      : { rows: [] };
    return {
      users: userCount.rows[0]?.count ?? "—",
      approvals: pendingApprovals.rows[0]?.count ?? "—",
      trend,
      departments: departments.rows,
    };
  });
  const text = (key: Parameters<typeof translate>[1]) => translate(user.locale, key);
  const locale = user.locale === "ht" ? "ht-HT" : user.locale === "en" ? "en-US" : "fr-FR";
  const projectProgressUpdatedAt = new Date("2026-10-26T12:00:00Z");
  const projectProgressDate = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(projectProgressUpdatedAt);
  const currency = (amount: string) => new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(Number(amount));

  return (
    <div className="dashboard-page">
      <div className="page-heading">
        <div><span className="eyebrow">{text("organizationSpace").toUpperCase()}</span><h1>{text("welcome")}, {user.fullName.split(" ")[0]}<span className="heading-period">.</span></h1><p>{text("overview")}</p></div>
        <div className="dashboard-controls">
          <div className="today-chip"><span className="today-dot" /> {new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date())}</div>
          <form method="get" className="dashboard-period">
            <label htmlFor="dashboard-months">{text("period")}</label>
            <select id="dashboard-months" name="months" defaultValue={String(months)}>
              <option value="1">{text("oneMonth")}</option><option value="3">{text("threeMonths")}</option>
              <option value="6">{text("sixMonths")}</option><option value="12">{text("twelveMonths")}</option>
            </select>
            <button className="button button-secondary" type="submit">{text("applyFilters")}</button>
          </form>
        </div>
      </div>
      <section className="metric-grid" aria-label={text("keyIndicators")}>
        <article className="metric-card metric-primary"><div className="metric-top"><span>{text("activeUsers")}</span><span className="metric-icon">♙</span></div><strong>{metrics.users}</strong><small>{text(globalDashboard ? "directoryNote" : "departmentUsersNote")}</small><div className="metric-decoration" /></article>
        <article className="metric-card"><div className="metric-top"><span>{text("pendingApprovals")}</span><span className="metric-icon icon-amber">◷</span></div><strong>{metrics.approvals}</strong><small>{text("requestsNote")}</small><div className="metric-bottom"><span className="metric-line" /></div></article>
        <article className="metric-card metric-light"><div className="metric-top"><span>{text("financeAccess")}</span><span className="metric-icon icon-green">↗</span></div><strong>{canReadFinance ? "✓" : "—"}</strong><small>{text(canReadFinance ? "authorized" : "permissionBased")}</small></article>
      </section>
      {metrics.trend.length > 0 && <section className="panel dashboard-trend-panel">
        <div className="panel-heading"><div><span className="eyebrow">{text("finance").toUpperCase()}</span><h2>{text("validatedCashFlow")}</h2></div><span className="count-pill">{months} {text(months === 1 ? "monthShort" : "monthsShort")}</span></div>
        <div className="table-scroll"><table><thead><tr><th>{text("month")}</th><th>{text("income")}</th><th>{text("expense")}</th></tr></thead>
          <tbody>{metrics.trend.map((row) => <tr key={row.month}><td>{new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(new Date(`${row.month}-01T12:00:00`))}</td><td>{currency(row.income_usd)}</td><td>{currency(row.expense_usd)}</td></tr>)}</tbody>
        </table></div>
      </section>}
      {metrics.departments.length > 0 && <section className="panel dashboard-departments">
        <div className="panel-heading"><div><span className="eyebrow">{text("administration").toUpperCase()}</span><h2>{text("departmentSummary")}</h2></div></div>
        <div className="department-summary-list">{metrics.departments.map((department) => <div key={department.name}><span>{department.name}</span><strong>{department.active_users}</strong></div>)}</div>
      </section>}
      <section className="dashboard-lower">
        <div className="panel welcome-panel">
          <div className="welcome-visual"><div className="visual-orbit orbit-one" /><div className="visual-orbit orbit-two" /><span className="visual-center">M</span><span className="visual-star star-one">✳</span><span className="visual-star star-two">✦</span></div>
          <div className="welcome-copy">
            <span className="eyebrow">PHASE 01 · FOUNDATION</span>
            <h2>{text("quickStart")}</h2>
            <p>{text("quickStartText")}</p>
            <div className="foundation-progress"><b>{text("currentProjectStage")}</b><small>{text("inProgress")}</small></div>
            <p className="project-progress-date"><span>{text("lastProjectUpdate")}:</span> <time dateTime="2026-10-26">{projectProgressDate}</time></p>
          </div>
        </div>
        <aside className="panel workspace-panel">
          <div className="panel-heading"><div><span className="eyebrow">{text("workspace").toUpperCase()}</span><h2>{text("profile")}</h2></div><span className="panel-icon">⌘</span></div>
          <div className="profile-row"><span className="profile-avatar">{user.fullName.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</span><div><strong>{user.fullName}</strong><small>{user.department ?? user.roles.join(" · ")}</small></div></div>
          <div className="profile-info"><div><span>{text("email")}</span><b>{user.email}</b></div><div><span>{text("language")}</span><b>{user.locale.toUpperCase()}</b></div><div><span>{text("displayCurrency")}</span><b>{user.displayCurrency}</b></div></div>
        </aside>
      </section>
      <div className="dashboard-footnote"><span>✳</span><p>{text("accessNote")}</p></div>
    </div>
  );
}
