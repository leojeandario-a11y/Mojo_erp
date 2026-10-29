import "server-only";
import nodemailer from "nodemailer";

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
}

export class EmailConfigurationError extends Error {}

export function getAppBaseUrl(): URL {
  const appBaseUrlValue = process.env.APP_BASE_URL?.trim();
  if (!appBaseUrlValue) {
    throw new EmailConfigurationError("APP_BASE_URL is required.");
  }
  let appBaseUrl: URL;
  try {
    appBaseUrl = new URL(appBaseUrlValue);
  } catch {
    throw new EmailConfigurationError("APP_BASE_URL must be an absolute HTTP(S) URL.");
  }
  const isLoopbackHttp =
    appBaseUrl.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(appBaseUrl.hostname);
  if (
    !["http:", "https:"].includes(appBaseUrl.protocol) ||
    (process.env.NODE_ENV === "production" && appBaseUrl.protocol !== "https:" && !isLoopbackHttp)
  ) {
    throw new EmailConfigurationError("APP_BASE_URL must use HTTPS in production, except for local loopback addresses.");
  }
  return appBaseUrl;
}

export function createPasswordResetUrl(token: string, locale: "fr" | "ht" | "en"): URL {
  const url = new URL("/reset-password", getAppBaseUrl());
  url.searchParams.set("token", token);
  url.searchParams.set("locale", locale);
  return url;
}

function readSmtpConfig(): SmtpConfig {
  const host = process.env.SMTP_HOST?.trim();
  const port = Number(process.env.SMTP_PORT ?? "587");
  const from = process.env.SMTP_FROM?.trim();
  const secureValue = process.env.SMTP_SECURE?.trim().toLowerCase();
  const user = process.env.SMTP_USER?.trim();
  const password = process.env.SMTP_PASSWORD;

  if (!host || !from || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new EmailConfigurationError("SMTP_HOST, SMTP_FROM, and a valid SMTP_PORT are required.");
  }
  if ((user && !password) || (!user && password)) {
    throw new EmailConfigurationError("SMTP_USER and SMTP_PASSWORD must be configured together.");
  }
  if (secureValue && secureValue !== "true" && secureValue !== "false") {
    throw new EmailConfigurationError("SMTP_SECURE must be true or false.");
  }

  getAppBaseUrl();

  const config: SmtpConfig = {
    host,
    port,
    secure: secureValue ? secureValue === "true" : port === 465,
    from,
    ...(user && password ? { user, password } : {}),
  };
  return config;
}

export function validatePasswordResetEmailConfig(): void {
  readSmtpConfig();
}

export function createPasswordResetTransport() {
  const config = readSmtpConfig();
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    ...(config.user && config.password ? { auth: { user: config.user, pass: config.password } } : {}),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });
  return { transport, from: config.from };
}

export async function sendPasswordResetEmail(
  to: string,
  fullName: string,
  token: string,
  locale: "fr" | "ht" | "en",
): Promise<void> {
  const { transport, from } = createPasswordResetTransport();
  const resetUrl = createPasswordResetUrl(token, locale);
  const copy = {
    fr: {
      subject: "Réinitialisation de votre mot de passe MoJo ERP",
      greeting: `Bonjour ${fullName},`,
      body: "Une demande de réinitialisation du mot de passe de votre compte MoJo ERP a été reçue.",
      action: "Choisir un nouveau mot de passe",
      expiry: "Ce lien expire dans une heure et ne peut être utilisé qu’une seule fois.",
      ignore: "Si vous n’avez pas demandé cette réinitialisation, vous pouvez ignorer cet e-mail.",
    },
    ht: {
      subject: "Reyajiste modpas kont MoJo ERP ou",
      greeting: `Bonjou ${fullName},`,
      body: "Nou resevwa yon demann pou reyajiste modpas kont MoJo ERP ou.",
      action: "Chwazi yon nouvo modpas",
      expiry: "Lyen sa a ap ekspire nan yon èdtan epi li ka sèvi yon sèl fwa.",
      ignore: "Si se pa ou ki te mande chanjman an, ou ka inyore imèl sa a.",
    },
    en: {
      subject: "Reset your MoJo ERP password",
      greeting: `Hello ${fullName},`,
      body: "We received a request to reset your MoJo ERP account password.",
      action: "Choose a new password",
      expiry: "This link expires in one hour and can only be used once.",
      ignore: "If you did not request this reset, you can ignore this email.",
    },
  }[locale];

  try {
    await transport.sendMail({
      from,
      to,
      subject: copy.subject,
      text: `${copy.greeting}\n\n${copy.body}\n\n${resetUrl.href}\n\n${copy.expiry}\n${copy.ignore}`,
      html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#18312d"><p>${escapeHtml(copy.greeting)}</p><p>${escapeHtml(copy.body)}</p><p><a href="${escapeHtml(resetUrl.href)}">${escapeHtml(copy.action)}</a></p><p>${escapeHtml(copy.expiry)}</p><p>${escapeHtml(copy.ignore)}</p></div>`,
    });
  } finally {
    transport.close();
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}
