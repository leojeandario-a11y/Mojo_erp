"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { AuthUser, DisplayCurrency, Locale } from "@/lib/auth";
import { messages, translate } from "@/lib/i18n";
import { hasAnyPermission, hasPermission } from "@/lib/permissions";
import { BrandLogo } from "@/components/brand-logo";
import { NotificationsMenu } from "@/components/notifications-menu";
import { UserAvatar } from "@/components/user-avatar";
import { isModuleIconName, ModuleIcon } from "@/components/module-icon";
import { formatExchangeRate } from "@/lib/money.mjs";

const modules = [
  { key: "dashboard", href: "/dashboard", icon: "dashboard", permission: [] },
  { key: "collaboration", href: "/collaboration", icon: "collaboration", permission: [] },
  { key: "finance", href: "/modules/finance", icon: "finance", permission: ["finance.transaction.read", "finance.transaction.create", "finance.transaction.reverse", "finance.account.manage", "finance.rate.manage", "finance.budget.read", "finance.budget.manage"] },
  { key: "hr", href: "/modules/hr", icon: "hr", permission: ["hr.employee.read", "hr.employee.manage", "hr.leave.request"] },
  { key: "business", href: "/modules/business", icon: "business", permission: ["business.customer.read", "business.contract.read"] },
  { key: "marketing", href: "/modules/marketing", icon: "marketing", permission: ["marketing.campaign.read", "marketing.campaign.manage"] },
  { key: "operations", href: "/modules/operations", icon: "operations", permission: ["operations.project.read", "operations.project.manage", "operations.task.manage"] },
  { key: "store", href: "/modules/store", icon: "store", permission: ["store.product.read", "store.product.manage", "store.stock.manage", "store.pos.sell", "store.exhibitor.manage", "store.exhibitor.validate", "store.exhibitor.pay", "store.report.read", "store.finance.read", "store.pos.return", "store.pos.void", "store.pos.configure"] },
  { key: "approvals", href: "/modules/approvals", icon: "approvals", permission: ["approvals.approve", "finance.transaction.create", "finance.budget.manage"] },
  { key: "reports", href: "/modules/reports", icon: "reports", permission: ["finance.report.read", "hr.report.read", "business.report.read", "marketing.report.read", "operations.report.read", "store.report.read"] },
] as const;

export function AppShell({ user, children }: { user: AuthUser; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [modulesExpanded, setModulesExpanded] = useState(true);
  const [adminExpanded, setAdminExpanded] = useState(true);
  const [latestRate, setLatestRate] = useState<string | null | undefined>(undefined);
  const [latestRateDate, setLatestRateDate] = useState<string | null>(null);
  const [rateUnavailable, setRateUnavailable] = useState(false);
  const text = messages[user.locale];
  const visibleModules = modules.filter((item) => item.permission.length === 0 || hasAnyPermission(user, item.permission));
  const adminLinks = [
    { key: "users", href: "/settings/users", permission: user.permissions.includes("*") || user.permissions.includes("settings.users.manage"), icon: "♙", label: text.users },
    { key: "roles", href: "/settings/roles", permission: user.permissions.includes("*") || user.permissions.includes("settings.roles.manage"), icon: "⚙", label: text.roles },
    { key: "approvalWorkflows", href: "/settings/approval-workflows", permission: hasAnyPermission(user, ["approvals.configure"]), icon: "✓", label: text.approvalWorkflows },
    { key: "audit", href: "/settings/audit", permission: hasPermission(user, "audit.read"), icon: "≋", label: text.audit },
    { key: "departments", href: "/settings/departments", permission: hasPermission(user, "settings.config.manage"), icon: "▦", label: text.departments },
    { key: "configuration", href: "/settings/configuration", permission: hasPermission(user, "settings.config.manage"), icon: "⚙", label: text.configuration },
  ] as const;
  const visibleAdminLinks = adminLinks.filter((item) => item.permission);
  const searchablePages = [
    ...visibleModules,
    { key: "profile" as const, href: "/profile", icon: "♙" },
    ...visibleAdminLinks.map(({ key, href, icon }) => ({ key, href, icon })),
  ].filter((item) => translate(user.locale, item.key).toLocaleLowerCase().includes(searchQuery.trim().toLocaleLowerCase()));

  useEffect(() => {
    document.documentElement.lang = user.locale === "ht" ? "ht" : user.locale;
  }, [user.locale]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/exchange-rates/latest")
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to load the latest exchange rate.");
        return response.json() as Promise<{ rate: string | null; rateDate: string | null }>;
      })
      .then((data) => {
        if (!cancelled) {
          setLatestRate(data.rate);
          setLatestRateDate(data.rateDate);
        }
      })
      .catch((error: unknown) => {
        console.error("Unable to load the latest exchange rate.", error);
        if (!cancelled) setRateUnavailable(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const rateDateLabel = latestRateDate
    ? new Intl.DateTimeFormat(user.locale === "ht" ? "ht-HT" : user.locale === "en" ? "en-US" : "fr-FR", {
      dateStyle: "short",
      timeZone: "UTC",
    }).format(new Date(`${latestRateDate}T00:00:00Z`))
    : null;

  async function updatePreference(field: "locale" | "displayCurrency", value: Locale | DisplayCurrency) {
    setSaving(true);
    try {
      setActionError("");
      const response = await fetch("/api/v1/auth/session", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      if (!response.ok) throw new Error("Unable to save preference.");
      router.refresh();
    } catch {
      setActionError(translate(user.locale, "requestFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function signOut() {
    setSigningOut(true);
    setActionError("");
    try {
      const response = await fetch("/api/v1/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Unable to sign out.");
      router.push("/login");
      router.refresh();
    } catch {
      setActionError(translate(user.locale, "requestFailed"));
      setSigningOut(false);
    }
  }

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <BrandLogo variant="dark" />
        <div className="sidebar-scroll">
          <div className="nav-caption">{text.organization}</div>
          <div className="nav-section">
            <button type="button" className="nav-section-toggle" aria-expanded={modulesExpanded} onClick={() => setModulesExpanded((value) => !value)}>
              <span>{text.organization}</span>
              <span className={`nav-section-caret ${modulesExpanded ? "open" : ""}`}>▾</span>
            </button>
            {modulesExpanded ? (
              <nav aria-label={text.dashboard}>
                {visibleModules.map(({ key, href, icon }) => (
                  <Link key={key} href={href} className={`nav-link ${pathname === href ? "active" : ""}`}>
                    <ModuleIcon name={icon} />{translate(user.locale, key)}
                    {key === "dashboard" && <span className="nav-active-dot" />}
                  </Link>
                ))}
              </nav>
            ) : null}
          </div>
          {visibleAdminLinks.length > 0 ? (
            <div className="sidebar-admin">
              <button type="button" className="nav-section-toggle nav-section-admin" aria-expanded={adminExpanded} onClick={() => setAdminExpanded((value) => !value)}>
                <span>{text.administration}</span>
                <span className={`nav-section-caret ${adminExpanded ? "open" : ""}`}>▾</span>
              </button>
              {adminExpanded ? (
                <div className="nav-sublist">
                  {visibleAdminLinks.map((item) => (
                    <Link key={item.key} href={item.href} className={`nav-link ${pathname.startsWith(item.href) ? "active" : ""}`}>
                      {isModuleIconName(item.icon) ? <ModuleIcon name={item.icon} /> : <span className="nav-icon">{item.icon}</span>}{item.label}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="sidebar-bottom">
          <button className="sidebar-signout" type="button" onClick={() => void signOut()} disabled={signingOut}>
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
              <path d="M10 17l5-5-5-5M15 12H3m9-8h6a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>{signingOut ? text.signingOut : text.signOut}</span>
          </button>
          <div className="connection-status"><span /> {text.systemOnline}</div>
          <div className="sidebar-user">
            <UserAvatar fullName={user.fullName} hasPhoto={user.hasProfilePhoto} photoVersion={user.profilePhotoVersion} className="sidebar-avatar" />
            <div className="sidebar-user-copy"><strong>{user.fullName}</strong><small>{user.department ?? user.roles[0] ?? text.account}</small></div>
          </div>
        </div>
      </aside>
      <main className="main-panel">
        <header className="topbar">
          <div className="breadcrumb"><span>{text.organization}</span><span className="crumb-slash">/</span><strong>{pageTitle(pathname, user.locale)}</strong></div>
          <div className="topbar-actions">
            <div className="quick-search">
              <label className="sr-only" htmlFor="page-search">{text.search}</label>
              <input id="page-search" type="search" value={searchQuery} placeholder={text.search}
                aria-controls="page-search-results" aria-expanded={Boolean(searchQuery.trim())}
                onChange={(event) => setSearchQuery(event.target.value)} />
              {searchQuery.trim() && <div id="page-search-results" className="quick-search-results" role="listbox" aria-label={text.search}>
                {searchablePages.length ? searchablePages.map((item) => (
                  <Link key={item.href} href={item.href} role="option" aria-selected="false" onClick={() => setSearchQuery("")}>
                    {isModuleIconName(item.icon) ? <ModuleIcon name={item.icon} /> : <span className="nav-icon">{item.icon}</span>}{translate(user.locale, item.key)}
                  </Link>
                )) : <span className="quick-search-empty">{text.noSearchResults}</span>}
              </div>}
            </div>
            <label className="sr-only" htmlFor="currency-choice">{text.currency}</label>
            <select id="currency-choice" className="select-compact" value={user.displayCurrency} disabled={saving}
              onChange={(event) => void updatePreference("displayCurrency", event.target.value as DisplayCurrency)}>
              <option value="HTG">HTG</option><option value="USD">USD</option>
            </select>
            <label className="sr-only" htmlFor="locale-choice">{text.language}</label>
            <select id="locale-choice" className="select-compact locale-choice" value={user.locale} disabled={saving}
              onChange={(event) => void updatePreference("locale", event.target.value as Locale)}>
              <option value="fr">FR</option><option value="ht">HT</option><option value="en">EN</option>
            </select>
            <NotificationsMenu locale={user.locale} />
            <Link className="top-avatar" href="/profile" aria-label={text.profile} title={text.profile}>
              <UserAvatar fullName={user.fullName} hasPhoto={user.hasProfilePhoto} photoVersion={user.profilePhotoVersion} size={34} />
            </Link>
          </div>
          <div className={`exchange-rate-status ${rateUnavailable ? "rate-unavailable" : ""}`} role="status">
            {rateUnavailable ? text.rateUnavailable : latestRate === null ? text.noExchangeRate
              : latestRate ? `${text.exchangeRate}: 1 USD = ${formatExchangeRate(latestRate, user.locale)} HTG${rateDateLabel ? ` · ${rateDateLabel}` : ""}` : ""}
          </div>
        </header>
        <div className="page-content">{actionError && <p className="form-error" role="alert">{actionError}</p>}{children}</div>
      </main>
    </div>
  );
}

function pageTitle(pathname: string, locale: Locale): string {
  if (pathname.startsWith("/collaboration")) return translate(locale, "collaboration");
  if (pathname.startsWith("/profile")) return translate(locale, "profile");
  if (pathname.startsWith("/settings/users")) return translate(locale, "users");
  if (pathname.startsWith("/settings/roles")) return translate(locale, "roles");
  if (pathname.startsWith("/settings/approval-workflows")) return translate(locale, "approvalWorkflows");
  if (pathname.startsWith("/settings/audit")) return translate(locale, "audit");
  if (pathname.startsWith("/settings/departments")) return translate(locale, "departments");
  if (pathname.startsWith("/settings/configuration")) return translate(locale, "configuration");
  if (pathname.startsWith("/modules/")) {
    const moduleKey = pathname.split("/")[2] as keyof typeof messages.fr;
    return messages[locale][moduleKey] ?? translate(locale, "dashboard");
  }
  return translate(locale, "dashboard");
}
