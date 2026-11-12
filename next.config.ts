import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: {
    root: process.cwd(),
  },
  async headers() {
    const jitsiDomain = process.env.JITSI_DOMAIN?.trim().toLowerCase() ?? "";
    const jitsiOrigin = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9-]{2,63}$/i.test(jitsiDomain)
      ? `https://${jitsiDomain}`
      : null;
    const securityHeaders = [
      { key: "Content-Security-Policy", value: `object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'${jitsiOrigin ? `; frame-src 'self' ${jitsiOrigin}` : ""}` },
      { key: "Permissions-Policy", value: jitsiOrigin
        ? `camera=(self "${jitsiOrigin}"), microphone=(self "${jitsiOrigin}"), geolocation=()`
        : "camera=(), microphone=(), geolocation=()" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
    ];
    if (process.env.NODE_ENV === "production" && process.env.APP_BASE_URL?.startsWith("https://")) {
      securityHeaders.push({ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" });
    }
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
