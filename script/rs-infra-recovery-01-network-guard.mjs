import net from "node:net";
import http from "node:http";
import https from "node:https";
import dgram from "node:dgram";
import process from "node:process";

let attempts = 0;
function denyNetwork() {
  attempts += 1;
  throw new Error("NETWORK_BLOCKED_BY_BACKEND_CONTRACT_TEST");
}

net.Socket.prototype.connect = denyNetwork;
for (const client of [http, https]) {
  client.request = denyNetwork;
  client.get = denyNetwork;
}
dgram.Socket.prototype.send = denyNetwork;
globalThis.fetch = async function blockedFetch() { return denyNetwork(); };

process.once("exit", () => {
  process.stdout.write(`BACKEND_CONTRACT_NETWORK_ATTEMPTS=${attempts}\n`);
  if (attempts !== 0) process.exitCode = 1;
});

export const getAttempts = () => attempts;
