import { execSync } from "node:child_process";
import type { NextConfig } from "next";

// Commit this build was made from. Open tabs poll /api/version and reload
// when the server starts serving a different one (see scripts/autoupdate.sh).
function gitVersion() {
  try {
    return execSync("git rev-parse HEAD").toString().trim();
  } catch {
    return "unknown";
  }
}

const nextConfig: NextConfig = {
  env: { APP_VERSION: gitVersion() },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
