/**
 * next.config.ts
 *
 * Next.js build and runtime configuration.
 *
 * Security headers are applied to every route via the `headers()` hook.
 * Image optimisation is configured via `images.remotePatterns` so that
 * next/image can serve IPFS and Arweave assets.
 *
 * Constants are sourced from `config/app.ts` to avoid magic strings.
 */

import withBundleAnalyzer from "@next/bundle-analyzer";
import type { NextConfig } from "next";

import { ALLOWED_IMAGE_URL_PATTERNS } from "./config/app";

// ---------------------------------------------------------------------------
// Content Security Policy
// ---------------------------------------------------------------------------

const cspValue = [
  "default-src 'self'",
  "script-src 'self' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://fonts.googleapis.com",
  "img-src 'self' data: https: blob:",
  "font-src 'self' https://fonts.gstatic.com https://fonts.googleapis.com",
  "connect-src 'self' https://horizon.stellar.org https://horizon-testnet.stellar.org https://soroban-rpc.mainnet.stellar.org https://soroban-rpc.testnet.stellar.org https://gateway.ipfs.io https://dweb.link https://*.ipfs.io wss:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "report-to csp-endpoint",
  "report-uri /api/csp-report",
].join("; ");

// ---------------------------------------------------------------------------
// Next.js config
// ---------------------------------------------------------------------------

const nextConfig: NextConfig = {
  // -------------------------------------------------------------------------
  // Image optimisation
  // -------------------------------------------------------------------------
  images: {
    /**
     * Allow next/image to fetch and optimise images from IPFS gateways and
     * Arweave.  Patterns are maintained in config/app.ts so they stay in sync
     * with the CSP connect-src and the TypeScript types.
     */
    remotePatterns: ALLOWED_IMAGE_URL_PATTERNS,
    /**
     * Serve AVIF first (best compression), then WebP as a fallback.
     * Browsers that support neither receive the original format.
     */
    formats: ["image/avif", "image/webp"],
    /**
     * Device widths used to generate the srcset for responsive images.
     * Covers from small mobile (320) up to wide-screen (1920).
     */
    deviceSizes: [320, 480, 640, 750, 828, 1080, 1200, 1920],
    /**
     * Fixed-size widths for the `sizes` attribute on icon / thumbnail images.
     */
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    /**
     * Minimum seconds a generated image variant is kept in the cache.
     * Default is 60 s; bump to 10 min since IPFS content is immutable.
     */
    minimumCacheTTL: 600,
    /**
     * Disable the blur placeholder computation on the server-side for
     * remote images (we supply our own static blur URI from config/app.ts).
     */
    dangerouslyAllowSVG: false,
    contentDispositionType: "attachment",
  },

  // -------------------------------------------------------------------------
  // Security headers
  // -------------------------------------------------------------------------
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: cspValue },
          {
            key: "Report-To",
            value:
              '{"group":"csp-endpoint","max_age":10886400,"endpoints":[{"url":"/api/csp-report"}]}',
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          { key: "X-DNS-Prefetch-Control", value: "on" },
        ],
      },
    ];
  },

  // #437 — code splitting: keep heavy vendor chunks separate so unchanged
  // pages don't bust the cache for unrelated vendor code.
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "recharts",
      "framer-motion",
      "react-icons",
    ],
  },
};

// #437 — wrap with bundle analyser; run `ANALYZE=true pnpm build` to open report
const analyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

export default analyzer(nextConfig);
