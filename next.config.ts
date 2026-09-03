import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Canonicalize URLs WITH a trailing slash.
  // =====================================================================
  // CRITICAL: the Z.ai preview gateway 301-redirects extensionless page
  // paths to their trailing-slash form (e.g. /dashboard -> /dashboard/).
  // With Next's default trailingSlash:false, Next 308-redirects them
  // right back (/dashboard/ -> /dashboard), producing an infinite
  // 301/308 ping-pong -> ERR_TOO_MANY_REDIRECTS in the preview.
  // Adopting the gateway's canonical form (trailing slash) makes both
  // layers agree: worst case there is exactly ONE redirect, never a loop.
  trailingSlash: true,
  // Allow the Z.ai preview domain to access /_next/* resources during dev.
  // The preview hostname format is preview-<bot-id>.space-z.ai.
  allowedDevOrigins: [
    "*.space-z.ai",
    "preview-*.space-z.ai",
    "preview-chat-*.space-z.ai",
  ],
};

export default nextConfig;
