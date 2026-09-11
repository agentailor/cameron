import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The floating dev badge overlaps the chat composer at the bottom of the viewport.
  devIndicators: false,
  // Emits .next/standalone with a self-contained server.js and only the traced dependencies, so
  // the runtime image needs no node_modules. Required by the `web` service in compose.yaml.
  output: "standalone",
  // Skills are read from disk at startup, not imported, so tracing cannot infer them.
  outputFileTracingIncludes: {
    "/**": ["./skills/**"],
  },
};

export default nextConfig;
