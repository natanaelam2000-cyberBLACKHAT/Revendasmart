import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e", testMatch: "sorteios-recovery.spec.ts", timeout: 60_000, workers: 1, retries: 0, reporter: "list",
  use: { baseURL: "http://127.0.0.1:4189", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: { env: { VITE_PUBLIC_APP_URL: "https://sorteios.example.test" }, command: "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4189 --strictPort", url: "http://127.0.0.1:4189", reuseExistingServer: false, timeout: 90_000 },
});
