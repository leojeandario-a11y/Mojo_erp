"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Locale } from "@/lib/auth";
import { translate } from "@/lib/i18n";

export function LoginForm({ locale }: { locale: Locale }) {
  const router = useRouter();
  const text = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      if (!response.ok) {
        setError(response.status === 401 || response.status === 400 ? text("loginFailure") : text("loginServerError"));
        return;
      }
      router.push("/dashboard");
    } catch {
      setError(text("networkError"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="login-form" onSubmit={submit}>
      <label htmlFor="email">{text("emailLabel")}</label>
      <input id="email" name="email" type="email" autoComplete="username" required maxLength={254} />
      <label htmlFor="password">{text("passwordLabel")}</label>
      <div className="password-field">
        <input id="password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required maxLength={128} />
        <button
          className="password-visibility-button"
          type="button"
          aria-label={showPassword ? text("hidePassword") : text("showPassword")}
          aria-pressed={showPassword}
          onClick={() => setShowPassword((visible) => !visible)}
        >
          {showPassword ? (
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
              <path d="m3 3 18 18M10.6 10.7a2 2 0 0 0 2.7 2.7M9.9 5.2A10.8 10.8 0 0 1 12 5c5.5 0 9 7 9 7a16 16 0 0 1-3.2 3.8M6.2 6.3C3.9 8 3 12 3 12s3.5 7 9 7a9.9 9.9 0 0 0 4-.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
              <path d="M3 12s3.5-7 9-7 9 7 9 7-3.5 7-9 7-9-7-9-7Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
              <circle cx="12" cy="12" r="2.5" stroke="currentColor" strokeWidth="1.7" />
            </svg>
          )}
        </button>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button button-primary login-submit" type="submit" disabled={pending}>
        {pending ? text("signingIn") : text("signIn")}
        <span aria-hidden="true">→</span>
      </button>
      <Link className="forgot-password-link" href={`/forgot-password?locale=${locale}`}>{text("forgotPassword")}</Link>
      <p className="login-note">{text("restrictedAccess")}</p>
    </form>
  );
}
