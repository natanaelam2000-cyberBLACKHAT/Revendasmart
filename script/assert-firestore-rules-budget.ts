import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const logPath = resolve(process.cwd(), "firestore-debug.log");
const log = readFileSync(logPath, "utf8");

assert.equal(
  log.includes("maximum of 1000 expressions to evaluate has been reached"),
  false,
  "Firestore Rules excederam o limite de 1000 expressões; permission-denied não pode mascarar este erro",
);

console.log("Firestore Rules expression budget passed: no 1000-expression limit errors.");
