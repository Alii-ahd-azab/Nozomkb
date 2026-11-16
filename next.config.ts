import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Week 7: BullMQ (Queue producer) and its Redis client run with Node's own
  // require() instead of being bundled into the server build.
  // Week 8: the local embedding model (ONNX Runtime, native binaries) is
  // loaded the same way (Next.js already lists these by default; explicit here).
  serverExternalPackages: ["bullmq", "ioredis", "@huggingface/transformers", "onnxruntime-node"],
};

export default nextConfig;
