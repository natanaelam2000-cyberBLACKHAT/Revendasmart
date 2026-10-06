import process from "node:process";

process.env.E2E_SPEC = "tests/e2e/ads-pro-final.spec.ts";
await import("./run-account-deletion-e2e.mjs");
