#!/usr/bin/env node

process.env.E2E_SPEC = "tests/e2e/auth-first-run.spec.ts";

await import("./run-account-deletion-e2e.mjs");
