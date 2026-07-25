/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: import.meta.dirname,
  // NEXT_PUBLIC_* values are inlined at build time, so exercising a different
  // configuration (e.g. the indexer path) needs its own build. An overridable
  // distDir lets those builds coexist instead of overwriting .next.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  webpack: (config) => {
    // Optional pretty-printer deps sometimes referenced by wallet SDKs.
    config.externals.push("pino-pretty", "lokijs", "encoding");
    return config;
  },
};
export default nextConfig;
