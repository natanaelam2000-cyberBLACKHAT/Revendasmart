import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL || "http://127.0.0.1:5000";
// Ambientes com um Chromium pré-instalado de outra versão (ex.: sandbox de CI) apontam para ele aqui, em vez
// de baixar o navegador; sem a variável nada muda.
const chromiumExecutable = process.env.E2E_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], ...(chromiumExecutable ? { launchOptions: { executablePath: chromiumExecutable } } : {}) },
    },
  ],
});
