"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";

interface Department { id: string; name: string }

export function RegistrationScreen() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [email, setEmail] = useState("");
  const [otpMode, setOtpMode] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void fetch("/api/v1/registration/departments")
      .then(async (response) => response.json() as Promise<{ departments?: Department[] }>)
      .then((data) => setDepartments(data.departments ?? []))
      .catch(() => setError("Impossible de charger les directions."));
  }, []);

  async function requestRegistration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setNotice("");
    const form = new FormData(event.currentTarget);
    const enteredEmail = String(form.get("email") ?? "").trim();
    try {
      const response = await fetch("/api/v1/registration/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fullName: form.get("fullName"),
          email: enteredEmail,
          departmentId: form.get("departmentId"),
          badgeId: form.get("badgeId"),
          password: form.get("password"),
        }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Inscription impossible.");
      setEmail(enteredEmail);
      setOtpMode(true);
      setNotice("Un code de vérification a été envoyé à votre adresse email.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Inscription impossible.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="login-screen">
      <section className="login-brand-side">
        <BrandLogo href="/login" className="login-brand" variant="dark" />
        <div className="login-message">
          <span className="eyebrow">MOJOPIKTURES · ACCÈS SÉCURISÉ</span>
          <h1>Créer votre<br /><em>compte ERP</em></h1>
          <p>Votre carte professionnelle autorise une demande d&apos;inscription, puis un administrateur valide votre accès.</p>
        </div>
      </section>
      <section className="login-form-side">
        <div className="login-card registration-card">
          <div className="login-greeting"><span className="login-icon">✓</span><span className="eyebrow">INSCRIPTION CONTRÔLÉE</span></div>
          {!otpMode ? (
            <>
              <h2>Vos informations</h2>
              <form className="login-form" onSubmit={requestRegistration}>
                <label htmlFor="fullName">Nom complet</label>
                <input id="fullName" name="fullName" required minLength={2} maxLength={160} autoComplete="name" />
                <label htmlFor="email">Email professionnel actif</label>
                <input id="email" name="email" type="email" required maxLength={254} autoComplete="email" />
                <label htmlFor="departmentId">Direction</label>
                <select id="departmentId" name="departmentId" required defaultValue="">
                  <option value="" disabled>Sélectionner une direction</option>
                  {departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}
                </select>
                <label htmlFor="badgeId">ID de carte</label>
                <input id="badgeId" name="badgeId" required pattern="[A-Za-z]{3}-[A-Za-z]{3}-[0-9]{8}" placeholder="MJP-DMC-00981028" autoComplete="off" />
                <label htmlFor="password">Mot de passe</label>
                <input id="password" name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" />
                <small>Le mot de passe doit contenir au moins 12 caractères.</small>
                {error && <p className="form-error" role="alert">{error}</p>}
                {notice && <p className="success-message" role="status">{notice}</p>}
                <button className="button button-primary login-submit" type="submit" disabled={pending}>{pending ? "Envoi..." : "Recevoir mon code"} <span aria-hidden="true">→</span></button>
              </form>
            </>
          ) : (
            <>
              <h2>Vérification email</h2>
              <p className="login-intro">Saisissez le code envoyé à {email}.</p>
              <OtpForm email={email} />
            </>
          )}
          <Link className="forgot-password-link" href="/login">Retour à la connexion</Link>
        </div>
      </section>
    </main>
  );
}

function OtpForm({ email }: { email: string }) {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/v1/registration/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, otp: form.get("otp") }),
      });
      const data = await response.json() as { error?: string; message?: string };
      if (!response.ok) throw new Error(data.error ?? "Code invalide.");
      setNotice(data.message ?? "Email vérifié. Demande en attente de validation.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Code invalide.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="login-form" onSubmit={submit}>
      <label htmlFor="otp">Code à 6 chiffres</label>
      <input id="otp" name="otp" inputMode="numeric" pattern="[0-9]{6}" required maxLength={6} />
      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="success-message" role="status">{notice}</p>}
      {!notice && <button className="button button-primary login-submit" type="submit" disabled={pending}>{pending ? "Vérification..." : "Valider le code"} <span aria-hidden="true">→</span></button>}
    </form>
  );
}
