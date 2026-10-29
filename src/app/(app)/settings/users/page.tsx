import { redirect } from "next/navigation";
import { UsersManager } from "@/components/users-manager";
import { getSession, hasPermission } from "@/lib/auth";
import { translate } from "@/lib/i18n";

export default async function UsersPage() {
  const user = await getSession();
  if (!user || !hasPermission(user, "settings.users.manage")) redirect("/dashboard");
  return <div className="admin-page"><div className="page-heading"><div><span className="eyebrow">{translate(user.locale, "adminSettings").toUpperCase()}</span><h1>{translate(user.locale, "users")}<span className="heading-period">.</span></h1><p>{translate(user.locale, "createUserDescription")}</p></div></div><UsersManager locale={user.locale} /></div>;
}
