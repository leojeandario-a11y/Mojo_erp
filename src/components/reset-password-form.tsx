"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import type { Locale } from "@/lib/auth";
import { translate } from "@/lib/i18n";

export function ResetPasswordForm({ locale, token }: { locale: Locale; token: string }) {
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);
  const [pending, setPending] = useState(false);
  const text = (key: Parameters<typeof translate>[1]) => translate(locale, key);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (password !== form.get("confirmPassword")) {
      setError(text("passwordMismatch"));
      return;
    }
    setPending(true);
    try {
      const response = await fetch("/api/v1/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      if (!response.ok) {
        setError(response.status === 400 ? text("invalidResetToken") : text("requestFailed"));
        return;
      }
      setComplete(true);
    } catch {
      setError(text("requestFailed"));
    } finally {
      setPending(false);
    }
  }

  if (!token) {
    return <><p className="form-error" role="alert">{text("invalidResetToken")}</p><Link className="forgot-password-link" href={`/forgot-password?locale=${locale}`}>{text("sendResetLink")}</Link></>;
  }
  if (complete) {
    return <><p className="success-message reset-result" role="status">{text("passwordResetSuccess")}</p><Link className="button button-primary login-submit" href={`/login?locale=${locale}`}>{text("backToLogin")} <span aria-hidden="true">→</span></Link></>;
  }

  return (
    <form className="login-form" onSubmit={submit}>
      <label htmlFor="new-password">{text("newPassword")}</label>
      <input id="new-password" name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} />
      <label htmlFor="confirm-password">{text("confirmPassword")}</label>
      <input id="confirm-password" name="confirmPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={128} />
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button button-primary login-submit" type="submit" disabled={pending}>
        {pending ? text("signingIn") : text("updatePassword")}<span aria-hidden="true">→</span>
      </button>
      <p className="reset-expiry">{text("resetLinkExpiry")}</p>
    </form>
  );
}
