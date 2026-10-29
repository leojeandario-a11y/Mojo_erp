import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/forgot-password-form";
import type { Locale } from "@/lib/auth";
import { translate } from "@/lib/i18n";
import { BrandLogo } from "@/components/brand-logo";

export const metadata: Metadata = { robots: { index: false, follow: false } };

function validLocale(value: string | undefined): Locale {
  return value === "ht" || value === "en" ? value : "fr";
}

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ locale?: string }>;
}) {
  const locale = validLocale((await searchParams).locale);
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
        <p className="login-intro">{translate(locale, "resetSubtitle")}</p>
        <ForgotPasswordForm locale={locale} />
        <div className="login-languages"><a href="/forgot-password?locale=fr">FR</a><i /><a href="/forgot-password?locale=ht">Kreyòl</a><i /><a href="/forgot-password?locale=en">English</a></div>
      </div></section>
    </main>
  );
}
