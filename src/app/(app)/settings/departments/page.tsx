import { redirect } from "next/navigation";
import { DepartmentsManager } from "@/components/departments-manager";
import { getSession, hasPermission } from "@/lib/auth";
import { translate } from "@/lib/i18n";

export default async function DepartmentsPage() {
  const user = await getSession();
  if (!user || !hasPermission(user, "settings.config.manage")) redirect("/dashboard");
  return (
    <div className="admin-page">
      <div className="page-heading">
        <div><span className="eyebrow">{translate(user.locale, "adminSettings").toUpperCase()}</span>
          <h1>{translate(user.locale, "departments")}<span className="heading-period">.</span></h1>
          <p>{translate(user.locale, "departmentsDescription")}</p>
        </div>
      </div>
      <DepartmentsManager locale={user.locale} />
    </div>
  );
}
