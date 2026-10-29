"use client";

import { useEffect, useState } from "react";
import type { Locale } from "@/lib/auth";
import { translate } from "@/lib/i18n";
import { LoginForm } from "@/components/login-form";
import { BrandLogo } from "@/components/brand-logo";

export function LoginScreen() {
  const [locale, setLocale] = useState<Locale>("fr");
  const text = (key: Parameters<typeof translate>[1]) => translate(locale, key);

  useEffect(() => {
    const savedLocale = document.cookie.match(/(?:^|;\s*)mojo_locale=(fr|ht|en)(?:;|$)/)?.[1] as Locale | undefined;
    if (savedLocale) setLocale(savedLocale);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale === "ht" ? "ht" : locale;
  }, [locale]);

  function selectLocale(nextLocale: Locale) {
    setLocale(nextLocale);
    document.cookie = `mojo_locale=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  }

  return (
    <main className="login-screen">
      <div className="login-decoration decoration-one" />
      <div className="login-decoration decoration-two" />
      <section className="login-brand-side">
        <BrandLogo href="/login" className="login-brand" variant="dark" />
        <div className="login-message">
          <span className="eyebrow">MOJOPIKTURES · MANAGEMENT SYSTEM</span>
          <h1>{text("headlineTop")}<br /><em>{text("headlineBottom")}</em></h1>
          <p>{text("platformLine")}</p>
        </div>
        <div className="login-footer">© 2026 MoJo PIKtures. {text("allRightsReserved")}</div>
      </section>
      <section className="login-form-side">
        <div className="login-card">
          <div className="login-greeting"><span className="login-icon">↗</span><span className="eyebrow">{text("secureSpace").toUpperCase()}</span></div>
          <h2>{text("signInTitle")}</h2>
          <p className="login-intro">{text("signInSubtitle")}</p>
          <LoginForm locale={locale} />
          <div className="login-languages" aria-label={text("language")}>
            <button type="button" className={locale === "fr" ? "selected" : ""} onClick={() => selectLocale("fr")}>FR</button>
            <i />
            <button type="button" className={locale === "ht" ? "selected" : ""} onClick={() => selectLocale("ht")}>Kreyòl</button>
            <i />
            <button type="button" className={locale === "en" ? "selected" : ""} onClick={() => selectLocale("en")}>English</button>
          </div>
        </div>
      </section>
    </main>
  );
}
