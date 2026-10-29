import Link from "next/link";
import { getSession } from "@/lib/auth";
import { translate } from "@/lib/i18n";

export default async function ForbiddenPage() {
  const user = await getSession();
  const locale = user?.locale ?? "fr";

  return (
    <main className="message-page">
      <span className="eyebrow">403 · MOJOPIKTURES</span>
      <h1>{translate(locale, "accessDenied")}</h1>
      <p>{translate(locale, "accessDeniedDescription")}</p>
      <Link className="button button-primary" href={user ? "/dashboard" : "/login"}>
        {translate(locale, user ? "backToDashboard" : "backToLogin")}
      </Link>
    </main>
  );
}
