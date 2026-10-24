import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";

test("service quota precheck blocks known limits and preserves the server authority on read failures", async () => {
  const output = await build({
    stdin: { contents: 'export { runWithServiceQuotaPrecheck } from "./services-persistence";', resolveDir: resolve("client/src/lib"), loader: "ts" },
    bundle: true, platform: "node", format: "cjs", write: false,
    plugins: [{ name: "quota-precheck-boundaries", setup(builder) {
      builder.onResolve({ filter: /^firebase\/firestore$|^\.\/firebase$|^\.\/api-client$/ }, args => ({ path: args.path, namespace: "boundary" }));
      builder.onLoad({ filter: /.*/, namespace: "boundary" }, ({ path }) => ({ contents:
        path === "firebase/firestore"
          ? 'export const collection=()=>{};export const doc=()=>{};export const getCountFromServer=()=>{};export const getDoc=()=>{};export const getDocs=()=>{};export const getFirestore=()=>{};export const orderBy=()=>{};export const query=()=>{};export const setDoc=()=>{throw Error("unexpected client write")};export const updateDoc=()=>{throw Error("unexpected client write")};'
          : path === "./firebase" ? 'export const getCurrentFirebaseUser=()=>null;'
          : 'export const apiRequest=()=>{throw Error("unexpected API call")};',
      }));
    } }],
  });
  const module = { exports: {} };
  runInNewContext(output.outputFiles[0].text, { module, exports: module.exports });
  const { runWithServiceQuotaPrecheck } = module.exports as typeof import("../client/src/lib/services-persistence");
  let creates = 0;
  const create = async () => { creates += 1; return "synthetic-service"; };
  assert.equal(await runWithServiceQuotaPrecheck("free", async () => 4, create), "synthetic-service");
  assert.equal(creates, 1);
  for (const [plan, count] of [["free", 5], ["pro", 50], ["premium", 200]] as const) {
    await assert.rejects(runWithServiceQuotaPrecheck(plan, async () => count, create), { name: "ServiceLimitError" });
    assert.equal(creates, 1, "known limits must block before calling the creation action");
  }
  const unavailableCount = async (): Promise<number> => { throw new Error("synthetic count unavailable"); };
  assert.equal(await runWithServiceQuotaPrecheck("free", unavailableCount, create), "synthetic-service");
  assert.equal(creates, 2, "a failed advisory read must still defer to the authoritative API");
  const serverQuotaError = Object.assign(new Error("synthetic authoritative limit"), { code: "PLAN_LIMIT_REACHED" });
  await assert.rejects(runWithServiceQuotaPrecheck("free", unavailableCount, async () => { throw serverQuotaError; }), error => error === serverQuotaError);
  const serverFailure = new Error("synthetic server failure");
  await assert.rejects(runWithServiceQuotaPrecheck("free", async () => 0, async () => { throw serverFailure; }), error => error === serverFailure);
});
