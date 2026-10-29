"use client";

import { useState, type FormEvent } from "react";
import type { Locale } from "@/lib/auth";
import { translate } from "@/lib/i18n";

export function ProfileForm({ locale }: { locale: Locale }) {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const text = (key: Parameters<typeof translate>[1]) => translate(locale, key);

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setPending(true);

    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const currentPassword = String(form.get("currentPassword") ?? "");
    const newPassword = String(form.get("newPassword") ?? "");
    if (newPassword !== form.get("confirmPassword")) {
      setError(text("passwordMismatch"));
      setPending(false);
      return;
    }

    try {
      const response = await fetch("/api/v1/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!response.ok) {
        setError(response.status === 400 ? text("changePasswordInvalid") : text("requestFailed"));
        return;
      }
      formElement.reset();
      setNotice(text("passwordChanged"));
    } catch {
      setError(text("requestFailed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="panel profile-settings-panel">
      <div className="panel-heading">
        <div><span className="eyebrow">{text("accountSecurity").toUpperCase()}</span><h2>{text("changePassword")}</h2></div>
      </div>
      <form className="stack-form profile-password-form" onSubmit={changePassword}>
        <label>{text("currentPassword")}<input name="currentPassword" type="password" autoComplete="current-password" required maxLength={128} /></label>
        <label>{text("newPassword")}<input name="newPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={128} /><small>{text("passwordMinimum")}</small></label>
        <label>{text("confirmPassword")}<input name="confirmPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={128} /></label>
        {notice && <p className="success-message" role="status">{notice}</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button button-primary" type="submit" disabled={pending}>
          {pending ? text("saving") : text("changePassword")}
        </button>
      </form>
    </section>
  );
}
