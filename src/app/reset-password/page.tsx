import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/reset-password-form";
import type { Locale } from "@/lib/auth";
import { translate } from "@/lib/i18n";
import { BrandLogo } from "@/components/brand-logo";

export const metadata: Metadata = { robots: { index: false, follow: false } };

function validLocale(value: string | undefined): Locale {
  return value === "ht" || value === "en" ? value : "fr";
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; locale?: string }>;
}) {
  const query = await searchParams;
  const locale = validLocale(query.locale);
  return (
    <main className="login-screen">
      <section className="login-brand-side">
        <BrandLogo href="/login" className="login-brand" variant="dark" />
        <div className="login-message"><span className="eyebrow">MOJOPIKTURES · MANAGEMENT SYSTEM</span>
          <h1>{translate(locale, "headlineTop")}<br /><em>{translate(locale, "headlineBottom")}</em></h1>
          <p>{translate(locale, "platformLine")}</p>
        </div>
        <div className="login-footer"><span>Haïti</span><span>·</span><span>Foundation 01</span></div>
      </section>
      <section className="login-form-side"><div className="login-card">
        <div className="login-greeting"><span className="login-icon">↗</span><span className="eyebrow">{translate(locale, "secureSpace").toUpperCase()}</span></div>
        <h2>{translate(locale, "resetPassword")}</h2>
        <p className="login-intro">{translate(locale, "resetLinkExpiry")}</p>
        <ResetPasswordForm locale={locale} token={query.token ?? ""} />
      </div></section>
    </main>
  );
}
