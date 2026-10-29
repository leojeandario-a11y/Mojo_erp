import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { translate } from "@/lib/i18n";
import { hasAnyPermission } from "@/lib/permissions";
import { ApprovalsManager } from "@/components/approvals-manager";

const modules = ["finance", "hr", "business", "marketing", "operations", "projects", "store", "approvals", "reports"] as const;
const requiredPermissions: Record<(typeof modules)[number], string[]> = {
  finance: ["finance.transaction.read", "finance.transaction.create", "finance.transaction.reverse", "finance.account.manage", "finance.rate.manage"],
  hr: ["hr.employee.read", "hr.employee.manage", "hr.leave.request"],
  business: ["business.customer.read", "business.contract.read"],
  marketing: ["marketing.campaign.read", "marketing.campaign.manage"],
  operations: ["operations.project.read", "operations.project.manage", "operations.task.manage"],
  projects: ["operations.project.read", "operations.project.manage"],
  store: ["store.product.read", "store.product.manage", "store.pos.sell"],
  approvals: ["approvals.approve"],
  reports: ["reports.export", "finance.report.read", "business.report.read"],
};

export default async function ModulePage({ params }: { params: Promise<{ module: string }> }) {
  const { module } = await params;
  if (!modules.includes(module as (typeof modules)[number])) notFound();
  const user = await getSession();
  if (!user) return null;
  if (!requiredPermissions[module as (typeof modules)[number]].some((permission) => hasAnyPermission(user, [permission]))) redirect("/forbidden");
  if (module === "approvals") return <ApprovalsManager locale={user.locale} />;
  return <div className="module-placeholder"><span className="module-placeholder-icon">✳</span><span className="eyebrow">MOJOPIKTURES · ROADMAP</span><h1>{translate(user.locale, module as (typeof modules)[number])}</h1><p>{translate(user.locale, "comingSoon")}</p><span className="phase-tag">PHASE EN PRÉPARATION</span></div>;
}
