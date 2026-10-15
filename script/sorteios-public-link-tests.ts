import assert from "node:assert/strict";
import { buildSorteioPublicUrl, copySorteioLink, shareSorteioLink, type SorteioLinkActions } from "../client/src/lib/sorteios-link";

const path = "/sorteio/campanha-teste?t=token-sanitizado";
const configured = "https://public.example.test";
const url = buildSorteioPublicUrl(path, configured);
assert.equal(url, configured + path);
assert.equal(new URL(url).pathname, "/sorteio/campanha-teste");
assert.equal(new URL(url).searchParams.get("t"), "token-sanitizado");
for (const local of ["https://localhost", "http://127.0.0.1:5000", "http://127.0.0.2", "http://[::1]", "http://dev.localhost", "capacitor://localhost", "invalid"]) {
  const result = buildSorteioPublicUrl(path, local);
  assert.equal(result, "https://revendasmart.vercel.app" + path);
  assert.ok(!result.includes("localhost") && !result.includes("127.0.0.1"));
}
assert.equal(buildSorteioPublicUrl(path, ""), "https://revendasmart.vercel.app" + path);
for (const origin of ["https://localhost", "http://127.0.0.1:5000", "https://development.example.test"]) {
  Object.defineProperty(globalThis, "window", { value: { location: { origin } }, configurable: true });
  assert.equal(buildSorteioPublicUrl(path), "https://revendasmart.vercel.app" + path, "unconfigured links must never infer the browser/development origin");
}
Reflect.deleteProperty(globalThis, "window");
const copied: string[] = [];
const shared: { url: string; title: string; text: string }[] = [];
const actions: SorteioLinkActions = {
  isNative: async () => true,
  nativeShare: async request => { shared.push(request); },
  webShare: async () => { throw new Error("Native Android must use the plugin"); },
  copy: async value => { copied.push(value); },
};
await copySorteioLink(url, actions);
assert.deepEqual(copied, [url]);
assert.equal(await shareSorteioLink(url, actions), "shared");
assert.equal(shared[0].url, url);
assert.deepEqual(shared[0], { title: "Sorteio Promocional", text: "Escolha seus números no sorteio:", url });
assert.deepEqual(copied, [url], "sharing must not silently copy");
assert.equal(await shareSorteioLink(url, { ...actions, isNative: async () => false, webShare: undefined }), "unavailable");
assert.equal(await shareSorteioLink(url, { ...actions, nativeShare: async () => { throw new Error("plugin failed"); } }), "failed");
assert.equal(await shareSorteioLink(url, { ...actions, nativeShare: async () => { throw new DOMException("cancelled", "AbortError"); } }), "cancelled");
assert.equal(await shareSorteioLink(url, { ...actions, isNative: async () => false, webShare: async request => { assert.equal(request.url, url); } }), "shared");
assert.deepEqual(copied, [url]);
await assert.rejects(copySorteioLink(url, { ...actions, copy: async () => { throw new Error("clipboard denied"); } }));
console.log("SORTEIOS-RECOVERY-02 public URL, copy, native/web share, failure/cancellation tests passed.");
