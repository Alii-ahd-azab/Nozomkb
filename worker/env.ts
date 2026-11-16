// The Worker is a plain Node process: unlike `next dev`, nothing loads
// .env.local for it. Load it explicitly (values already present in the real
// environment win), and never print the values.
import { existsSync } from "node:fs";
import path from "node:path";

export function loadWorkerEnv() {
  for (const name of [".env.local", ".env"]) {
    const file = path.join(process.cwd(), name);

    if (existsSync(file)) {
      process.loadEnvFile(file);
    }
  }

  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. Run the Worker from the project root with a .env.local file."
    );
  }
}
