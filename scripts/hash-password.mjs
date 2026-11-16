// Admin/provisioning helper: prints a bcrypt hash for a password.
// Usage: node scripts/hash-password.mjs "the-password"
// Store ONLY the printed hash in users.password_hash — never the password.
import bcrypt from "bcryptjs";

const password = process.argv[2];

if (!password) {
  console.error('Usage: node scripts/hash-password.mjs "the-password"');
  process.exit(1);
}

console.log(await bcrypt.hash(password, 10));
