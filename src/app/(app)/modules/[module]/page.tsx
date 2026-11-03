import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { translate } from "@/lib/i18n";
import { hasAnyPermission } from "@/lib/permissions";
import { ApprovalsManager } from "@/components/approvals-manager";
import { BusinessManager } from "@/components/business-manager";
import { FinanceManager } from "@/components/finance-manager";
import { HrManager } from "@/components/hr-manager";
import { MarketingManager } from "@/components/marketing-manager";
import { OperationsManager } from "@/components/operations-manager";
import { ReportsManager } from "@/components/reports-manager";
import { StoreManager } from "@/components/store-manager";

const modules = ["finance", "hr", "business", "marketing", "operations", "projects", "store", "approvals", "reports"] as const;
const reportPermissions = [
  "finance.report.read", "hr.report.read", "business.report.read",
  "marketing.report.read", "operations.report.read", "store.report.read",
];
const requiredPermissions: Record<(typeof modules)[number], string[]> = {
  finance: ["finance.transaction.read", "finance.transaction.create", "finance.transaction.reverse", "finance.account.manage", "finance.rate.manage"],
  hr: ["hr.employee.read", "hr.employee.manage", "hr.leave.request"],
  business: ["business.customer.read", "business.contract.read"],
  marketing: ["marketing.campaign.read", "marketing.campaign.manage"],
  operations: ["operations.project.read", "operations.project.manage", "operations.task.manage"],
  projects: ["operations.project.read", "operations.project.manage"],
  store: [
    "store.product.read", "store.product.manage", "store.stock.manage", "store.pos.sell",
    "store.exhibitor.manage", "store.exhibitor.validate", "store.exhibitor.pay",
    "store.report.read", "store.finance.read", "store.pos.return", "store.pos.void",
    "store.pos.configure",
  ],
  approvals: ["approvals.approve", "finance.transaction.create", "finance.budget.manage"],
  reports: reportPermissions,
};

export default async function ModulePage({ params }: { params: Promise<{ module: string }> }) {
  const { module } = await params;
  if (!modules.includes(module as (typeof modules)[number])) notFound();
  const user = await getSession();
  if (!user) return null;
  if (module === "projects") redirect("/modules/operations");
  if (!requiredPermissions[module as (typeof modules)[number]].some((permission) => hasAnyPermission(user, [permission]))) redirect("/forbidden");
  if (module === "approvals") return <ApprovalsManager locale={user.locale} />;
  if (module === "business") return <BusinessManager />;
  if (module === "finance") return <FinanceManager locale={user.locale} canReadAccounts={hasAnyPermission(user, ["finance.account.manage", "*"])} canManageRates={hasAnyPermission(user, ["finance.rate.manage", "*"])} />;
  if (module === "hr") return <HrManager canManage={hasAnyPermission(user, ["hr.employee.manage", "*"])} canManageAttendance={hasAnyPermission(user, ["hr.attendance.manage", "*"])} />;
  if (module === "marketing") return <MarketingManager permissions={user.permissions} />;
  if (module === "operations") return <OperationsManager permissions={user.permissions} />;
  if (module === "store") return <StoreManager locale={user.locale} user={{ id: user.id, fullName: user.fullName, permissions: user.permissions, entityPermissions: user.entityPermissions }} />;
  if (module === "reports") return <ReportsManager locale={user.locale} />;
  return <div className="module-placeholder"><span className="module-placeholder-icon">✳</span><span className="eyebrow">MOJOPIKTURES · ROADMAP</span><h1>{translate(user.locale, module as (typeof modules)[number])}</h1><p>{translate(user.locale, "comingSoon")}</p><span className="phase-tag">PHASE EN PRÉPARATION</span></div>;
}
