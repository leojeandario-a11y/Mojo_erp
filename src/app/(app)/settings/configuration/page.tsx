import { redirect } from "next/navigation";
import { SettingsManager } from "@/components/settings-manager";
import { getSession, hasPermission } from "@/lib/auth";
import { translate } from "@/lib/i18n";

export default async function ConfigurationPage() {
  const user = await getSession();
  if (!user || !hasPermission(user, "settings.config.manage")) redirect("/dashboard");
  return (
    <div className="admin-page">
      <div className="page-heading">
        <div><span className="eyebrow">{translate(user.locale, "adminSettings").toUpperCase()}</span>
          <h1>{translate(user.locale, "configuration")}<span className="heading-period">.</span></h1>
          <p>{translate(user.locale, "configurationDescription")}</p>
        </div>
      </div>
      <SettingsManager locale={user.locale} />
    </div>
  );
}
