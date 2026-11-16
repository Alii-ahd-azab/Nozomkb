// Redis connections for BullMQ (ioredis). We create the client ourselves
// instead of letting BullMQ lazily require() ioredis, which is unreliable
// inside the Next.js server bundle.
import IORedis from "ioredis";
import { getRedisUrl } from "@/lib/processing/config";

type Purpose = "queue" | "worker";

export function createRedisConnection(purpose: Purpose) {
  const connection = new IORedis(getRedisUrl(), {
    connectionName: `nozomkb-${purpose}`,
    // Workers use blocking commands: BullMQ requires null here.
    // The web app should fail fast instead of hanging an upload request.
    maxRetriesPerRequest: purpose === "worker" ? null : 1,
    connectTimeout: 3000,
  });

  // Without a listener ioredis prints "Unhandled error event". Log each
  // distinct problem once instead of on every reconnect attempt.
  let lastMessage = "";
  connection.on("error", (error: Error) => {
    if (error.message !== lastMessage) {
      lastMessage = error.message;
      console.error(`[redis:${purpose}] ${error.message}`);
    }
  });
  connection.on("ready", () => {
    lastMessage = "";
  });

  return connection;
}
