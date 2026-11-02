import { redirect } from "next/navigation";
import { ApprovalWorkflowsManager } from "@/components/approval-workflows-manager";
import { getSession } from "@/lib/auth";
import { hasAnyPermission } from "@/lib/permissions";
import { translate } from "@/lib/i18n";

export default async function ApprovalWorkflowsPage() {
  const user = await getSession();
  if (!user || !hasAnyPermission(user, ["approvals.configure"])) {
    redirect("/dashboard");
  }
  return (
    <div className="admin-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">{translate(user.locale, "adminSettings").toUpperCase()}</span>
          <h1>{translate(user.locale, "approvalWorkflows")}<span className="heading-period">.</span></h1>
          <p>{translate(user.locale, "approvalWorkflowsDescription")}</p>
        </div>
      </div>
      <ApprovalWorkflowsManager locale={user.locale} />
    </div>
  );
}
