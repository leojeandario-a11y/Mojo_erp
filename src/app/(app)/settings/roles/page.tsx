import { redirect } from "next/navigation";
import { RolesManager } from "@/components/roles-manager";
import { getSession, hasPermission } from "@/lib/auth";
import { translate } from "@/lib/i18n";

export default async function RolesPage() {
  const user = await getSession();
  if (!user || !hasPermission(user, "settings.roles.manage")) redirect("/dashboard");
  return <div className="admin-page"><div className="page-heading"><div><span className="eyebrow">{translate(user.locale, "adminSettings").toUpperCase()}</span><h1>{translate(user.locale, "roles")}<span className="heading-period">.</span></h1><p>{translate(user.locale, "rolesDescription")}</p></div></div><RolesManager locale={user.locale} /></div>;
}
