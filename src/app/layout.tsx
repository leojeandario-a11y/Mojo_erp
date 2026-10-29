import type { Metadata, Viewport } from "next";
import { ServiceWorkerRegister } from "@/components/service-worker-register";
import "./globals.css";

export const metadata: Metadata = {
  title: "MoJo ERP — MoJoPIKtures",
  description: "Plateforme de gestion intégrée MoJoPIKtures",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#071b2d",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body suppressHydrationWarning>
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
