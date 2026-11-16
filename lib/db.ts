// Fails the build if a Client Component ever imports the database layer,
// so DATABASE_URL can never end up in the browser bundle.
import "server-only";
import { Pool } from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not defined.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export default pool;
