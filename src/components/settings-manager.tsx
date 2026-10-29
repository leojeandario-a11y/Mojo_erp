"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { Locale } from "@/lib/auth";
import { translate } from "@/lib/i18n";

interface Settings {
  reference_currency: "HTG" | "USD";
  default_display_currency: "HTG" | "USD";
  fiscal_year_start_month: number;
  session_ttl_minutes: number;
  max_failed_logins: number;
  supported_locales: string[];
}

export function SettingsManager({ locale }: { locale: Locale }) {
  const text = useCallback((key: Parameters<typeof translate>[1]) => translate(locale, key), [locale]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/v1/settings")
      .then(async (response) => {
        if (!response.ok) throw new Error(text("requestFailed"));
        const data = await response.json() as { settings: Array<{ key: keyof Settings; value: unknown }> };
        const values = Object.fromEntries(data.settings.map(({ key, value }) => [key, value]));
        const referenceCurrency = values.reference_currency;
        const defaultDisplayCurrency = values.default_display_currency;
        const fiscalYearStartMonth = Number(values.fiscal_year_start_month);
        const sessionTtlMinutes = Number(values.session_ttl_minutes);
        const maxFailedLogins = Number(values.max_failed_logins);
        const supportedLocales = values.supported_locales;
        if (
          (referenceCurrency !== "HTG" && referenceCurrency !== "USD")
          || (defaultDisplayCurrency !== "HTG" && defaultDisplayCurrency !== "USD")
          || !Number.isInteger(fiscalYearStartMonth) || fiscalYearStartMonth < 1 || fiscalYearStartMonth > 12
          || !Number.isInteger(sessionTtlMinutes) || sessionTtlMinutes < 1 || sessionTtlMinutes > 43_200
          || !Number.isInteger(maxFailedLogins) || maxFailedLogins < 1 || maxFailedLogins > 20
          || !Array.isArray(supportedLocales) || supportedLocales.some((item) => typeof item !== "string")
        ) {
          throw new Error(text("invalidSettings"));
        }
        setSettings({
          reference_currency: referenceCurrency,
          default_display_currency: defaultDisplayCurrency,
          fiscal_year_start_month: fiscalYearStartMonth,
          session_ttl_minutes: sessionTtlMinutes,
          max_failed_logins: maxFailedLogins,
          supported_locales: supportedLocales,
        });
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : text("requestFailed")));
  }, [text]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/v1/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          settings: {
            reference_currency: settings.reference_currency,
            default_display_currency: settings.default_display_currency,
            fiscal_year_start_month: settings.fiscal_year_start_month,
            session_ttl_minutes: settings.session_ttl_minutes,
            max_failed_logins: settings.max_failed_logins,
          },
        }),
      });
      if (!response.ok) throw new Error(text("requestFailed"));
      setNotice(text("settingsSaved"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : text("requestFailed"));
    } finally {
      setSaving(false);
    }
  }

  if (!settings) return <section className="panel"><p className={error ? "form-error" : "muted"}>{error || text("loading")}</p></section>;
  return <form className="panel settings-form" onSubmit={save}>
    <div className="panel-heading"><div><span className="eyebrow">{text("configuration").toUpperCase()}</span><h2>{text("systemPreferences")}</h2></div></div>
    <div className="settings-grid">
      <label>{text("referenceCurrency")}<select value={settings.reference_currency} onChange={(event) => setSettings({ ...settings, reference_currency: event.target.value === "HTG" ? "HTG" : "USD" })}>
        <option value="USD">USD</option><option value="HTG">HTG</option>
      </select></label>
      <label>{text("defaultDisplayCurrency")}<select value={settings.default_display_currency} onChange={(event) => setSettings({ ...settings, default_display_currency: event.target.value === "HTG" ? "HTG" : "USD" })}>
        <option value="USD">USD</option><option value="HTG">HTG</option>
      </select></label>
      <label>{text("fiscalYearStartMonth")}<input type="number" min={1} max={12} value={settings.fiscal_year_start_month} onChange={(event) => setSettings({ ...settings, fiscal_year_start_month: Number(event.target.value) })} /></label>
      <label>{text("sessionTtlMinutes")}<input type="number" min={1} max={43200} value={settings.session_ttl_minutes} onChange={(event) => setSettings({ ...settings, session_ttl_minutes: Number(event.target.value) })} /></label>
      <label>{text("maxFailedLogins")}<input type="number" min={1} max={20} value={settings.max_failed_logins} onChange={(event) => setSettings({ ...settings, max_failed_logins: Number(event.target.value) })} /></label>
      <label>{text("supportedLocales")}<input value={settings.supported_locales.join(", ")} disabled readOnly /></label>
    </div>
    {notice && <p className="success-message" role="status">{notice}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="button button-primary" disabled={saving}>{saving ? text("saving") : text("saveChanges")}</button>
  </form>;
}
