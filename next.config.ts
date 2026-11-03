import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";
// Preview environments (e.g. an IDE sandbox) embed the app in an iframe.
// Off by default so deployments stay frame-ancestors 'none'.
const allowEmbed = process.env.ALLOW_IFRAME_EMBED === "1";

/**
 * Security headers.
 * CSP is intentionally explicit: no third-party scripts are ever loaded, so the
 * allowlist stays tight. `'unsafe-inline'` is required by the Next.js runtime
 * (inline bootstrap + style injection); everything else is locked down.
 */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'" + (isProd ? "" : " 'unsafe-eval'"),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://mainnet.base.org https://base-rpc.publicnode.com https://*.base.org wss://*.base.org",
  `frame-ancestors ${allowEmbed ? "*" : "'none'"}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["better-sqlite3", "postgres"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          ...(allowEmbed ? [] : [{ key: "X-Frame-Options", value: "DENY" }]),
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          ...(isProd
            ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
            : []),
        ],
      },
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
    ];
  },
};

export default nextConfig;
