"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import type { Locale } from "@/lib/auth";
import { translate } from "@/lib/i18n";

export function ForgotPasswordForm({ locale }: { locale: Locale }) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const text = (key: Parameters<typeof translate>[1]) => translate(locale, key);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/v1/auth/password-reset-request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: form.get("email") }),
      });
      const result = await response.json();
      if (response.status === 503) {
        setError(text("resetEmailUnavailable"));
        return;
      }
      if (!response.ok) {
        setError(text("requestFailed"));
        return;
      }
      setSent(true);
      setMessage(result.message ?? text("resetRequestSent"));
    } catch {
      setError(text("requestFailed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="login-form" onSubmit={submit}>
      {sent ? <p className="success-message reset-result" role="status">{message}</p> : (
        <>
          <label htmlFor="reset-email">{text("emailLabel")}</label>
          <input id="reset-email" name="email" type="email" autoComplete="email" required maxLength={254} />
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button button-primary login-submit" type="submit" disabled={pending}>
            {pending ? text("signingIn") : text("sendResetLink")}<span aria-hidden="true">→</span>
          </button>
        </>
      )}
      <p className="reset-expiry">{text("resetLinkExpiry")}</p>
      <Link className="forgot-password-link" href={`/login?locale=${locale}`}>← {text("backToLogin")}</Link>
    </form>
  );
}
