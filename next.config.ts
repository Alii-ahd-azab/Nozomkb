import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Week 7: BullMQ (Queue producer) and its Redis client run with Node's own
  // require() instead of being bundled into the server build.
  serverExternalPackages: ["bullmq", "ioredis"],
};

export default nextConfig;
