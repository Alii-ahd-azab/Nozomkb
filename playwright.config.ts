import { defineConfig, devices } from "@playwright/test";

// E2E tests drive a real Chromium browser against the production build.
//   npm run build && npm run test:e2e
// or against an already running app:
//   BASE_URL=http://localhost:3000 npm run test:e2e
const baseURL = process.env.BASE_URL ?? "http://localhost:3100";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  workers: 1,
  reporter: "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: "npm run start -- -p 3100",
        url: `${baseURL}/login`,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
