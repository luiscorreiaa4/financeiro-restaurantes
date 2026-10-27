import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@app/config", "@app/core"],
};

export default nextConfig;
