import nextEnv from "@next/env";
import nodemailer from "nodemailer";

nextEnv.loadEnvConfig(process.cwd());

const recipient = process.argv[2];
if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
  console.error("Provide a valid test recipient email address.");
  process.exitCode = 2;
} else {
  const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD, SMTP_FROM } = process.env;
  const port = Number(SMTP_PORT);
  if (
    !SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD || !SMTP_FROM
    || !Number.isInteger(port) || port < 1 || port > 65_535
    || !["true", "false"].includes((SMTP_SECURE ?? "").toLowerCase())
  ) {
    console.error("SMTP settings are incomplete or invalid.");
    process.exitCode = 2;
  } else {
    const transport = nodemailer.createTransport({
      host: SMTP_HOST,
      port,
      secure: SMTP_SECURE.toLowerCase() === "true",
      auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
    });

    try {
      await transport.verify();
      await transport.sendMail({
        from: SMTP_FROM,
        to: recipient,
        subject: "MoJo ERP — test de configuration du courriel",
        text: "Ce courriel confirme que la configuration SMTP de MoJo ERP fonctionne.",
      });
      console.log(`SMTP verified; one test email was sent to ${recipient}.`);
    } catch (error) {
      const code = error instanceof Error && "code" in error && typeof error.code === "string"
        ? error.code
        : "SMTP_ERROR";
      console.error(`SMTP test failed (${code}). No credential values were displayed.`);
      process.exitCode = 1;
    } finally {
      transport.close();
    }
  }
}
