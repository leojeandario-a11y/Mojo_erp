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
                COALESCE(sum(t.amount_usd) FILTER (WHERE t.tx_type = 'income'
                  OR (t.tx_type = 'adjustment' AND t.adjustment_direction = 'increase')), 0)::text AS income_usd,
                COALESCE(sum(t.amount_usd) FILTER (WHERE t.tx_type = 'expense'
                  OR (t.tx_type = 'adjustment' AND t.adjustment_direction = 'decrease')), 0)::text AS expense_usd
         FROM period
         LEFT JOIN transactions t ON t.status IN ('validated', 'reversed')
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
  const currency = (amount: string) => new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(Number(amount));
  const compactCurrency = (amount: number) => new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(amount);
  const incomeTotal = metrics.trend.reduce((total, row) => total + Number(row.income_usd), 0);
  const expenseTotal = metrics.trend.reduce((total, row) => total + Number(row.expense_usd), 0);
  const netTotal = incomeTotal - expenseTotal;
  const maxTrendValue = Math.max(0, ...metrics.trend.flatMap((row) => [
    Number(row.income_usd),
    Number(row.expense_usd),
  ]));
  const stepMagnitude = maxTrendValue > 0 ? 10 ** Math.floor(Math.log10(maxTrendValue / 4)) : 1;
  const rawStep = maxTrendValue / 4 / stepMagnitude;
  const chartStep = stepMagnitude * (rawStep <= 1 ? 1 : rawStep <= 2 ? 2 : rawStep <= 5 ? 5 : 10);
  const chartMaximum = chartStep * 4;
  const chart = { width: 760, left: 60, right: 746, top: 20, bottom: 220 };
  const plotHeight = chart.bottom - chart.top;
  const plotWidth = chart.right - chart.left;
  const departmentMaximum = Math.max(1, ...metrics.departments.map((department) => Number(department.active_users)));

  return (
    <div className="dashboard-page">
      <header className="page-heading dashboard-hero">
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
      </header>
      <section className="metric-grid" aria-label={text("keyIndicators")}>
        <article className="metric-card metric-primary"><div className="metric-top"><span>{text("activeUsers")}</span><span className="metric-icon">♙</span></div><strong>{metrics.users}</strong><small>{text(globalDashboard ? "directoryNote" : "departmentUsersNote")}</small><div className="metric-decoration" /></article>
        <article className="metric-card"><div className="metric-top"><span>{text("pendingApprovals")}</span><span className="metric-icon icon-amber">◷</span></div><strong>{metrics.approvals}</strong><small>{text("requestsNote")}</small><div className="metric-bottom"><span className="metric-line" /></div></article>
        <article className="metric-card metric-light"><div className="metric-top"><span>{text(canReadFinance ? "netCashFlow" : "financeAccess")}</span><span className="metric-icon icon-green">↗</span></div><strong>{canReadFinance ? currency(String(netTotal)) : "—"}</strong><small>{text(canReadFinance ? "validatedCashFlow" : "permissionBased")}</small></article>
      </section>
      <section className={`dashboard-overview-grid${metrics.trend.length ? "" : " dashboard-overview-no-trend"}`}>
        {metrics.trend.length > 0 && <section className="panel dashboard-trend-panel" aria-labelledby="dashboard-cash-flow-title">
          <div className="panel-heading">
            <div><span className="eyebrow">{text("finance").toUpperCase()}</span><h2 id="dashboard-cash-flow-title">{text("validatedCashFlow")}</h2></div>
            <span className="count-pill">{months} {text(months === 1 ? "monthShort" : "monthsShort")}</span>
          </div>
          <div className="dashboard-chart-summary">
            <div><span>{text("income")}</span><strong>{currency(String(incomeTotal))}</strong></div>
            <div><span>{text("expense")}</span><strong>{currency(String(expenseTotal))}</strong></div>
            <div className={netTotal < 0 ? "dashboard-net-negative" : ""}><span>{text("netCashFlow")}</span><strong>{currency(String(netTotal))}</strong></div>
          </div>
          <div className="dashboard-chart-legend" aria-hidden="true">
            <span><i className="legend-income" />{text("income")}</span>
            <span><i className="legend-expense" />{text("expense")}</span>
          </div>
          <div className="dashboard-chart-scroll">
            <svg className="dashboard-cash-flow-chart" viewBox={`0 0 ${chart.width} 260`} role="img" aria-labelledby="dashboard-chart-title dashboard-chart-description">
              <title id="dashboard-chart-title">{text("validatedCashFlow")}</title>
              <desc id="dashboard-chart-description">{text("cashFlowChartDescription")}</desc>
              {Array.from({ length: 5 }, (_, index) => {
                const value = chartMaximum * index / 4;
                const y = chart.bottom - plotHeight * index / 4;
                return <g key={index}>
                  <line x1={chart.left} y1={y} x2={chart.right} y2={y} className="chart-grid-line" />
                  <text x={chart.left - 10} y={y + 4} textAnchor="end" className="chart-axis-label">{compactCurrency(value)}</text>
                </g>;
              })}
              {metrics.trend.map((row, index) => {
                const groupWidth = plotWidth / metrics.trend.length;
                const center = chart.left + groupWidth * (index + 0.5);
                const barWidth = Math.min(20, groupWidth * 0.28);
                const gap = Math.min(5, groupWidth * 0.07);
                const income = Math.max(0, Number(row.income_usd));
                const expense = Math.max(0, Number(row.expense_usd));
                const incomeHeight = income > 0 ? Math.max(2, plotHeight * income / chartMaximum) : 0;
                const expenseHeight = expense > 0 ? Math.max(2, plotHeight * expense / chartMaximum) : 0;
                const monthDate = new Date(`${row.month}-01T12:00:00Z`);
                return <g key={row.month}>
                  <rect x={center - gap / 2 - barWidth} y={chart.bottom - incomeHeight} width={barWidth} height={incomeHeight} rx="3" className="chart-income-bar">
                    <title>{`${text("income")} · ${new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(monthDate)}: ${currency(row.income_usd)}`}</title>
                  </rect>
                  <rect x={center + gap / 2} y={chart.bottom - expenseHeight} width={barWidth} height={expenseHeight} rx="3" className="chart-expense-bar">
                    <title>{`${text("expense")} · ${new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(monthDate)}: ${currency(row.expense_usd)}`}</title>
                  </rect>
                  <text x={center} y="246" textAnchor="middle" className="chart-axis-label">
                    {new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(monthDate)}
                  </text>
                </g>;
              })}
            </svg>
          </div>
          <details className="dashboard-data-details">
            <summary>{text("viewMonthlyDetails")}</summary>
            <div className="table-scroll"><table><thead><tr><th>{text("month")}</th><th>{text("income")}</th><th>{text("expense")}</th></tr></thead>
              <tbody>{metrics.trend.map((row) => <tr key={row.month}><td>{new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${row.month}-01T12:00:00Z`))}</td><td>{currency(row.income_usd)}</td><td>{currency(row.expense_usd)}</td></tr>)}</tbody>
            </table></div>
          </details>
        </section>}
        <div className="dashboard-side-stack">
          {metrics.departments.length > 0 && <section className="panel dashboard-departments" aria-labelledby="dashboard-departments-title">
            <div className="panel-heading"><div><span className="eyebrow">{text("administration").toUpperCase()}</span><h2 id="dashboard-departments-title">{text("departmentSummary")}</h2></div></div>
            <div className="department-summary-list">{metrics.departments.map((department) => {
              const activeUsers = Number(department.active_users);
              return <div className="department-summary-item" key={department.name}>
                <div className="department-summary-heading"><span>{department.name}</span><strong>{department.active_users}</strong></div>
                <div className="department-summary-track" role="meter" aria-label={department.name} aria-valuemin={0} aria-valuemax={departmentMaximum} aria-valuenow={activeUsers}>
                  <span style={{ width: `${activeUsers / departmentMaximum * 100}%` }} />
                </div>
              </div>;
            })}</div>
          </section>}
          <aside className="panel workspace-panel">
            <div className="panel-heading"><div><span className="eyebrow">{text("workspace").toUpperCase()}</span><h2>{text("profile")}</h2></div><span className="panel-icon">⌘</span></div>
            <div className="profile-row"><span className="profile-avatar">{user.fullName.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</span><div><strong>{user.fullName}</strong><small>{user.department ?? user.roles.join(" · ")}</small></div></div>
            <div className="profile-info"><div><span>{text("email")}</span><b>{user.email}</b></div><div><span>{text("language")}</span><b>{user.locale.toUpperCase()}</b></div><div><span>{text("displayCurrency")}</span><b>{user.displayCurrency}</b></div></div>
          </aside>
        </div>
      </section>
      <div className="dashboard-footnote"><span>✳</span><p>{text("accessNote")}</p></div>
    </div>
  );
}
