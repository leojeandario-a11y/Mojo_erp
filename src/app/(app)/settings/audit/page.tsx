import { redirect } from "next/navigation";
import { AuditViewer } from "@/components/audit-viewer";
import { getSession, hasPermission } from "@/lib/auth";
import { translate } from "@/lib/i18n";

export default async function AuditPage() {
  const user = await getSession();
  if (!user || !hasPermission(user, "audit.read")) redirect("/dashboard");
  return (
    <div className="admin-page">
      <div className="page-heading">
        <div><span className="eyebrow">{translate(user.locale, "adminSettings").toUpperCase()}</span>
          <h1>{translate(user.locale, "audit")}<span className="heading-period">.</span></h1>
          <p>{translate(user.locale, "auditDescription")}</p>
        </div>
      </div>
      <AuditViewer locale={user.locale} />
    </div>
  );
}
