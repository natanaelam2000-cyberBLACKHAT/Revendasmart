/**
 * MOTION-SYSTEM-01 / RS-MOTION-02 — testes do Motion System (launch + conclusão do onboarding).
 *
 * O motor (`client/public/motion/revendasmart-motion.v2.js`) é executado de verdade num `vm` com relógio,
 * DOM, matchMedia e sessionStorage falsos: o que é provado aqui é o comportamento real do arquivo
 * publicado, não uma reimplementação. A fiação com o React (ponte, LaunchReady, onboarding, bootstrap
 * do index.html) é provada por asserção de código-fonte, no mesmo estilo dos demais testes do repo.
 *
 * Invariante central: MOTION != BOOTSTRAP AUTHORITY — a motion só RECEBE o sinal de "app pronto" e só o
 * usa para decidir quando PODE sair; nunca decide auth/settings/plano/tenant e nunca segura o app.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const MOTION_FILE = "client/public/motion/revendasmart-motion.v2.js";
const MOTION_V1_FILE = "client/public/motion/revendasmart-motion.v1.js";
const motionSource = fs.readFileSync(MOTION_FILE, "utf8");
const SYMBOL_SRC = "/logo-revenda-smart-symbol-official.png";
const LOCKUP_SRC = "/logo-revenda-smart-official.png";

function read(path: string): string {
  return fs.readFileSync(path, "utf8");
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

// ---------------------------------------------------------------------------------------------------
// Ambiente falso
// ---------------------------------------------------------------------------------------------------

class FakeEl {
  tag: string;
  attrs: Record<string, string> = {};
  className = "";
  innerHTML = "";
  textContent = "";
  src = "";
  async = false;
  onerror: (() => void) | null = null;
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  constructor(tag: string) {
    this.tag = tag;
  }
  setAttribute(key: string, value: string) {
    this.attrs[key] = value;
  }
  appendChild(child: FakeEl) {
    child.parent = this;
    this.children.push(child);
    return child;
  }
  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
}

class FakeClock {
  now = 0;
  private nextId = 1;
  private timers = new Map<number, { due: number; fn: () => void }>();
  setTimeout = (fn: () => void, ms: number) => {
    const id = this.nextId++;
    this.timers.set(id, { due: this.now + (ms || 0), fn });
    return id;
  };
  clearTimeout = (id: number) => {
    this.timers.delete(id);
  };
  pending(): number {
    return this.timers.size;
  }
  advance(ms: number) {
    const target = this.now + ms;
    for (;;) {
      let nextId = -1;
      let nextDue = Infinity;
      for (const [id, t] of this.timers) {
        if (t.due <= target && (t.due < nextDue || (t.due === nextDue && id < nextId))) {
          nextId = id;
          nextDue = t.due;
        }
      }
      if (nextId === -1) break;
      const timer = this.timers.get(nextId)!;
      this.timers.delete(nextId);
      this.now = Math.max(this.now, timer.due);
      timer.fn();
    }
    this.now = target;
  }
}

interface EnvOptions {
  path?: string;
  search?: string;
  native?: boolean;
  standalone?: boolean;
  webview?: boolean;
  reduced?: boolean;
  sessionSeen?: boolean;
  sessionBlocked?: boolean;
  preReady?: boolean;
  failCreateElement?: boolean;
  noBody?: boolean;
  /** Estado do PNG do lockup oficial visto pelo motor (sem a opção, o DOM falso não expõe querySelector). */
  lockup?: "loaded" | "pending" | "broken";
}

interface FakeImg {
  complete: boolean;
  naturalWidth: number;
  onload: (() => void) | null;
  decoded: number;
  decode(): Promise<void>;
}

interface Env {
  win: any;
  clock: FakeClock;
  head: FakeEl;
  body: FakeEl;
  session: Map<string, string>;
  lockupImg: FakeImg;
  overlays(): FakeEl[];
  phase(): string | undefined;
  step(): string | undefined;
  styleText(): string;
}

const SESSION_KEY = "rs:launch-motion:v2";

function createEnv(opts: EnvOptions = {}): Env {
  const clock = new FakeClock();
  const head = new FakeEl("head");
  const body = new FakeEl("body");
  const session = new Map<string, string>();
  if (opts.sessionSeen) session.set(SESSION_KEY, "1");

  const lockupImg: FakeImg = {
    complete: opts.lockup !== "pending",
    naturalWidth: opts.lockup === "loaded" ? 1254 : 0,
    onload: null,
    decoded: 0,
    decode() {
      this.decoded++;
      return Promise.resolve();
    },
  };
  const documentElement = new FakeEl("html");
  const doc = {
    head,
    body: opts.noBody ? null : body,
    documentElement,
    createElement: (tag: string) => {
      if (opts.failCreateElement) throw new Error("dom unavailable");
      const el = new FakeEl(tag);
      if (opts.lockup) (el as any).querySelector = (sel: string) => (sel === "img[data-lockup]" && el.innerHTML.includes(LOCKUP_SRC) ? lockupImg : null);
      return el;
    },
  };

  const win: any = {
    document: doc,
    location: { pathname: opts.path ?? "/", search: opts.search ?? "" },
    navigator: { userAgent: opts.webview ? "Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36" : "Mozilla/5.0 (Linux; Android 14)" },
    performance: { now: () => clock.now },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    matchMedia: (query: string) => ({
      matches: query.includes("prefers-reduced-motion") ? Boolean(opts.reduced) : query.includes("display-mode: standalone") ? Boolean(opts.standalone) : false,
    }),
    sessionStorage: {
      getItem: (key: string) => {
        if (opts.sessionBlocked) throw new Error("blocked");
        return session.get(key) ?? null;
      },
      setItem: (key: string, value: string) => {
        if (opts.sessionBlocked) throw new Error("blocked");
        session.set(key, value);
      },
    },
  };
  if (opts.native) win.Capacitor = { isNativePlatform: () => true };
  if (opts.preReady) win.rsMotion = { r: 1, ready() {}, play() {} };
  win.window = win;
  win.document = doc;

  vm.createContext(win);
  vm.runInContext(motionSource, win, { filename: MOTION_FILE });

  const overlays = () => (opts.noBody ? documentElement : body).children.filter((c) => c.className === "rsm");
  return {
    win,
    clock,
    head,
    body,
    session,
    lockupImg,
    overlays,
    phase: () => overlays()[0]?.attrs["data-phase"],
    step: () => overlays()[0]?.attrs["data-step"],
    styleText: () => head.children.find((c) => c.tag === "style")?.textContent ?? "",
  };
}

type Profile = { min: number; target: number; max: number };
type LaunchProfile = Profile & { brand: number; reveal: number };
const forced = { search: "?launch-motion=1" };
const timing = createEnv(forced).win.rsMotion.timing as {
  launch: LaunchProfile & { reduced: LaunchProfile };
  complete: Profile & { reduced: Profile };
  exitMs: number;
};
const MIN = timing.launch.min;
const TARGET = timing.launch.target;
const MAX = timing.launch.max;
const EXIT = timing.exitMs;
const BRAND = timing.launch.brand;
const REVEAL = timing.launch.reveal;

type Result = { reason: string; ms: number };

async function main() {
  // ===== §Timing: contrato dos números =====
  // MIN subiu de 900 (v1) para 1450: na v2 o lockup completo só fica parado em BRAND+REVEAL (1070ms);
  // com 900 a infraestrutura cortaria a motion no meio da transformação símbolo → marca.
  assert.equal(MIN, 1450, "MOTION_MIN_MS");
  assert.equal(TARGET, 1450, "MOTION_TARGET_MS: a sequência termina parada no lockup; depois disso é hold");
  assert.equal(MAX, 2500, "MOTION_MAX_MS (teto inalterado desde a v1)");
  assert.equal(EXIT, 260, "saída");
  assert.ok(MIN <= TARGET && TARGET <= MAX && MAX <= 2500, "min <= target <= max <= 2500ms (sem espera artificial longa)");
  assert.ok(MAX + EXIT < 3000, "a saída completa precisa caber antes do failsafe CSS de 3s");
  assert.ok(BRAND + REVEAL <= MIN, "o lockup completo aparece ANTES da primeira saída permitida");
  assert.ok(MIN - (BRAND + REVEAL) >= 300, "hold do lockup completo (reconhecimento da marca) de pelo menos 300ms");
  assert.ok(BRAND >= 500, "o símbolo fica sozinho, como protagonista, por pelo menos 500ms");
  assert.ok(MIN + EXIT >= 1600 && MIN + EXIT <= 2000, "boot pronto: ~1,6–2,0s no total (nunca de novo uma splash de 3–4s)");
  const reducedLaunch = timing.launch.reduced;
  assert.ok(reducedLaunch.brand + reducedLaunch.reveal <= reducedLaunch.min && reducedLaunch.max <= MAX, "reduced: marca completa antes da saída, teto não maior");

  // ===== FAST BOOT: app pronto antes do mínimo → nunca sai antes de MIN, sai exatamente em MIN =====
  {
    const env = createEnv(forced);
    const done = env.win.rsMotion.play("launch") as Promise<Result>; // single-flight: devolve a promise do autoLaunch
    assert.equal(env.overlays().length, 1, "launch forçado precisa ter criado o overlay");
    env.clock.advance(100);
    env.win.rsMotion.ready();
    env.clock.advance(MIN - 100 - 1);
    assert.equal(env.phase(), "run", "app pronto cedo NÃO pode cortar a motion antes do mínimo visível");
    env.clock.advance(1);
    assert.equal(env.phase(), "exit", "no mínimo e com app pronto, a saída começa");
    env.clock.advance(EXIT);
    assert.equal(env.overlays().length, 0, "overlay removido ao fim da saída");
    const result = await done;
    assert.equal(result.reason, "ready");
    assert.equal(result.ms, MIN + EXIT);
  }

  // ===== Estado pré-pronto (React venceu o carregamento do motor, via stub do bootstrap) =====
  {
    const env = createEnv({ ...forced, preReady: true });
    env.clock.advance(MIN);
    assert.equal(env.phase(), "exit", "ready reportado antes do motor carregar não pode se perder");
  }

  // ===== MOTION COMPLETES BEFORE APP (slow boot): hold no último quadro até pronto ou MAX =====
  {
    const env = createEnv(forced);
    env.clock.advance(TARGET);
    assert.equal(env.phase(), "hold", "no fim natural da sequência, sem app pronto, o último quadro fica parado (hold)");
    env.clock.advance(200); // t = TARGET + 200, app ainda não pronto
    assert.equal(env.phase(), "hold", "sem ready a motion NÃO sai por conta própria antes de MAX");
    assert.equal(env.step(), "brand", "o hold é o lockup completo parado (nada novo entra na tela)");
    env.win.rsMotion.ready(); // app pronto durante o hold
    assert.equal(env.phase(), "exit", "app pronto durante o hold libera a saída imediatamente");
    env.clock.advance(EXIT);
    assert.equal(env.overlays().length, 0);
  }

  // ===== APP NEVER READY: MAX encerra; motion não concede prontidão =====
  {
    const env = createEnv(forced);
    const done = env.win.rsMotion.play("launch") as Promise<Result>;
    env.clock.advance(MAX - 1);
    assert.equal(env.overlays().length, 1);
    assert.notEqual(env.phase(), "exit", "antes de MAX, sem ready, não sai");
    env.clock.advance(1);
    assert.equal(env.phase(), "exit", "em MAX sai de qualquer jeito — o loader/erro real do app assume (nunca loop infinito)");
    env.clock.advance(EXIT);
    assert.equal(env.overlays().length, 0);
    const result = await done;
    assert.equal(result.reason, "max", "saída por teto precisa ser distinguível de saída por app pronto");
    assert.equal(result.ms, MAX + EXIT);

    // MOTION != BOOTSTRAP AUTHORITY: terminar a motion NÃO vira "app pronto" para a próxima.
    env.win.rsMotion.play("launch");
    env.clock.advance(MIN);
    assert.notEqual(env.phase(), "exit", "motion concluída não pode ter marcado o app como pronto");
    assert.equal(Object.keys(env.win).filter((k) => /ready|authenticated|settings|plan|tenant|business/i.test(k) && k !== "rsMotion").length, 0, "motion não pode publicar nenhum estado de app em window");
    assert.equal(env.body.attrs["data-app-ready"], undefined);
  }

  // ===== APP COMPLETES BEFORE MOTION: ready em qualquer ponto ≥ MIN sai na hora, < MIN espera =====
  {
    const env = createEnv(forced);
    env.clock.advance(BRAND + REVEAL); // símbolo → marca acabou de terminar; ainda antes do mínimo
    env.win.rsMotion.ready();
    assert.equal(env.phase(), "run", "app pronto logo após o reveal: a marca completa ainda ganha o hold até MIN");
    env.clock.advance(MIN - (BRAND + REVEAL));
    assert.equal(env.phase(), "exit", "e sai exatamente em MIN");

    const late = createEnv(forced);
    late.clock.advance(MIN + 300); // no hold (≥ MIN)
    assert.equal(late.phase(), "hold");
    late.win.rsMotion.ready();
    assert.equal(late.phase(), "exit", "app pronto depois do mínimo: sai na hora, sem esperar MAX");
  }

  // ===== REDUCED MOTION =====
  {
    const env = createEnv({ ...forced, reduced: true });
    assert.equal(env.overlays()[0]?.attrs["data-reduced"], "1");
    env.win.rsMotion.ready();
    env.clock.advance(timing.launch.reduced.min - 1);
    assert.equal(env.phase(), "run");
    env.clock.advance(1);
    assert.equal(env.phase(), "exit", "reduced: só fades, mínimo menor");
    assert.ok(timing.launch.reduced.min < MIN);
    const css = env.styleText();
    const reducedBlock = css.slice(css.indexOf("@media (prefers-reduced-motion:reduce)"));
    assert.ok(reducedBlock.length > 0, "CSS precisa ter o bloco prefers-reduced-motion");
    assert.match(reducedBlock, /\.rsm-sat\{?[^}]*display:none|\.rsm-dot,\.rsm-sat,\.rsm-halo\{display:none\}/, "reduced: sem satélites/trajetória");
    const reducedRules = reducedBlock.slice(0, reducedBlock.indexOf("@keyframes rsm-rfade"));
    assert.doesNotMatch(reducedRules, /translate|rotate|scale|rsm-out|rsm-in|rsm-settle|rsm-zoom|rsm-move|rsm-track|rsm-name|rsm-lift|rsm-sym /, "reduced: sem trajetória nem zoom");
    // Launch reduced: símbolo (fade) → marca completa (fade do lockup oficial inteiro) → app.
    assert.match(reducedRules, /\.rsm-wm\{display:none\}/, "reduced: o nome não desliza");
    assert.match(reducedRules, /\.rsm-sym\{animation:rsm-rfade [^}]*\}/, "reduced: símbolo só aparece em fade");
    assert.match(reducedRules, /\.rsm\[data-step=brand\] \.rsm-hero\{animation:rsm-rhide [^}]*\}/, "reduced: símbolo sai em fade, sem trajetória");
    assert.match(reducedRules, /\.rsm\[data-step=brand\] \.rsm-full\{display:block;animation:rsm-rfade [^}]*\}/, "reduced: marca completa entra em fade");
    assert.equal(env.step(), "brand", "reduced também chega à marca completa antes da saída");

    const slow = createEnv({ ...forced, reduced: true });
    slow.clock.advance(timing.launch.reduced.max);
    assert.equal(slow.phase(), "exit", "reduced + app lento: teto menor, sem perda funcional");
  }

  // ===== LAUNCH v2: contrato visual (símbolo → símbolo + nome → app) =====
  {
    const env = createEnv(forced);
    const overlay = env.overlays()[0];
    const html = overlay.innerHTML;
    assert.equal(overlay.attrs["data-scene"], "launch");
    assert.equal(env.win.rsMotion.version, 2, "motor v2");

    // Sem satélites, ícones, halo, ponto central, gráfico, calendário: a v1 orbital saiu da launch.
    assert.doesNotMatch(html, /rsm-sat|rsm-dot|rsm-halo|rsm-check|rsm-msg|<svg|<path/, "launch v2 não tem feature satellites/ícones/halo");
    for (const path of ["M21 8l-9-5-9 5v8l9 5 9-5z", "M4 6h16v14H4z", "M4 4h7v7H4z"]) assert.ok(!html.includes(path), `launch sem ícone de feature (${path})`);
    assert.doesNotMatch(motionSource, /launch:\s*\[/, "não existe mais lista de ícones para a launch");

    // Marca oficial: símbolo oficial + lockup oficial (o nome vem do próprio PNG — nada redesenhado).
    assert.ok(html.includes(`class="rsm-sym" src="${SYMBOL_SRC}"`), "fase 1 usa o símbolo oficial");
    assert.ok(html.includes(`src="${LOCKUP_SRC}"`), "a marca completa usa o lockup oficial");
    assert.equal(new Set(html.match(/src="[^"]+"/g)).size, 2, "só os dois PNGs oficiais");

    // Sem slogan/texto: o overlay não tem nenhum nó de texto; "Revenda Smart" é o asset oficial.
    assert.equal(html.replace(/<[^>]*>/g, "").trim(), "", "launch sem slogan, sem frase, sem texto");
    assert.doesNotMatch(html, /alt="[^"]/, "imagens decorativas (alt vazio) num overlay aria-hidden");

    // Sequência: símbolo sozinho → marca completa → hold → saída (nunca antes de a marca estar completa).
    assert.equal(env.step(), "symbol", "começa com o símbolo sozinho");
    env.clock.advance(BRAND - 1);
    assert.equal(env.step(), "symbol");
    env.clock.advance(1);
    assert.equal(env.step(), "brand", "em BRAND o símbolo vira a marca completa");
    env.win.rsMotion.ready();
    env.clock.advance(REVEAL);
    assert.equal(env.phase(), "run", "marca completa já parada, e a motion ainda não saiu");
    env.clock.advance(MIN - BRAND - REVEAL);
    assert.equal(env.phase(), "exit");

    // As durações do CSS do reveal batem com timing.launch.reveal (o lockup termina antes de MIN).
    const css = env.styleText();
    const motionCss = css.slice(0, css.indexOf("@media (prefers-reduced-motion:reduce)"));
    let revealEnd = 0;
    for (const rule of motionCss.match(/\.rsm\[data-step=brand\] \.rsm-(?:hero|wm|wc|wt)\{[^}]*\}/g) ?? []) {
      const [, dur, delay] = rule.match(/animation:rsm-\w+ (\d+)ms cubic-bezier\([^)]*\)(?: (\d+)ms)? both/) ?? [];
      assert.ok(dur, `animação do reveal sem duração explícita: ${rule}`);
      revealEnd = Math.max(revealEnd, Number(dur) + Number(delay ?? 0));
    }
    assert.equal(revealEnd, REVEAL, "o CSS do reveal termina exatamente em BRAND + REVEAL");

    // Shared element: um único símbolo do início ao fim; ele se move até o aro do lockup. Só transform/opacity animam.
    assert.equal((html.match(/rsm-sym/g) ?? []).length, 1, "um único elemento de símbolo (sem troca de PNG)");
    assert.match(css, /@keyframes rsm-move\{to\{transform:translateX\(calc\(var\(--u\)\*-380\)\) scale\(\.6945\)\}\}/, "o símbolo reduz e reposiciona até o aro do lockup");
    const keyframes = css.match(/@keyframes rsm-(?:sym|fade|move|track|counter|name|lift)\{.*?\}\}/g) ?? [];
    assert.equal(keyframes.length, 7);
    for (const k of keyframes) assert.doesNotMatch(k.replace(/@keyframes rsm-\w+/, ""), /(?:^|[{;])(?!transform|opacity)[a-z-]+:/, `launch anima só transform/opacity (compositor): ${k}`);
    assert.doesNotMatch(css, /rsm-sym\{[^}]*rotate|@keyframes rsm-(?:sym|move)\{[^}]*rotate/, "sem rotação");
  }

  // ===== LAUNCH v2: PNG do lockup ausente/atrasado nunca mostra nome "pela metade" nem segura o app =====
  {
    const loaded = createEnv({ ...forced, lockup: "loaded" });
    assert.ok(loaded.lockupImg.decoded > 0, "o lockup é decodificado antes do reveal");
    loaded.clock.advance(BRAND);
    assert.equal(loaded.step(), "brand", "lockup carregado: reveal no tempo");

    const broken = createEnv({ ...forced, lockup: "broken" });
    broken.win.rsMotion.ready();
    broken.clock.advance(BRAND);
    assert.equal(broken.step(), "symbol", "lockup quebrado: o símbolo segue sozinho (fallback limpo)");
    broken.clock.advance(MIN - BRAND);
    assert.equal(broken.phase(), "exit", "e a saída continua exatamente igual (fail-open)");

    const pendingOk = createEnv({ ...forced, lockup: "pending" });
    pendingOk.clock.advance(BRAND);
    assert.equal(pendingOk.step(), "symbol");
    pendingOk.clock.advance(100);
    pendingOk.lockupImg.onload?.();
    assert.equal(pendingOk.step(), "brand", "lockup chegou a tempo de completar antes de MIN: revela");

    const pendingLate = createEnv({ ...forced, lockup: "pending" });
    pendingLate.clock.advance(MIN - REVEAL + 1);
    pendingLate.lockupImg.onload?.();
    assert.equal(pendingLate.step(), "symbol", "lockup tarde demais: não começa um reveal que seria cortado");

    const cancelled = createEnv({ ...forced, lockup: "pending" });
    cancelled.clock.advance(BRAND);
    cancelled.win.rsMotion.cancel();
    assert.equal(cancelled.lockupImg.onload, null, "cancel/fim limpa o handler do lockup");
  }

  // ===== COLD START ONLY =====
  {
    assert.equal(createEnv().overlays().length, 0, "navegador comum (web) não ganha motion de launch");
    assert.equal(createEnv({ native: true }).overlays().length, 1, "WebView nativo Capacitor, cold start: motion");
    assert.equal(createEnv({ webview: true }).overlays().length, 1, "WebView Android (UA wv) sem Capacitor injetado ainda: motion");
    assert.equal(createEnv({ standalone: true }).overlays().length, 1, "PWA/TWA instalado: motion");
    assert.equal(createEnv({ native: true, path: "/orders" }).overlays().length, 1, "cold start direto numa rota privada também");

    const native = createEnv({ native: true });
    assert.equal(native.session.get(SESSION_KEY), "1", "cold start grava o marcador de sessão");
    assert.equal(createEnv({ native: true, sessionSeen: true }).overlays().length, 0, "reload no mesmo WebView/aba (já tocou) não repete");
    assert.equal(createEnv({ native: true, sessionBlocked: true }).overlays().length, 1, "sessionStorage bloqueado: ainda toca (uma vez por documento), sem lançar");
    assert.equal(createEnv({ ...forced, sessionSeen: true }).overlays().length, 1, "?launch-motion=1 força para QA, ignorando o marcador");
    assert.equal(createEnv({ native: true, search: "?launch-motion=0" }).overlays().length, 0, "?launch-motion=0 desliga");

    // Resume/navegação/modal: o script só roda no carregamento do documento e não registra nenhum
    // listener de lifecycle que pudesse repetir a motion.
    const code = stripComments(motionSource);
    assert.doesNotMatch(code, /addEventListener|visibilitychange|appStateChange|pageshow|resume|popstate|hashchange/, "sem listener de lifecycle: voltar do background/trocar aba/navegar não repete a motion");

    // Single-flight: nunca empilha overlays.
    const env = createEnv({ native: true });
    const first = env.win.rsMotion.play("launch");
    const second = env.win.rsMotion.play("complete", "products");
    assert.equal(first, second, "play durante outra motion devolve a MESMA promise");
    assert.equal(env.overlays().length, 1, "nunca empilha overlays");
  }

  // ===== Rotas públicas: o autoLaunch nunca roda (deriva guardada contra App.tsx) =====
  {
    const appSource = read("client/src/App.tsx");
    const fn = appSource.match(/function isPublicPath\(path: string\) \{([\s\S]*?)\n\}/);
    assert.ok(fn, "isPublicPath precisa existir em App.tsx");
    const literals = [...fn![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    assert.ok(literals.length >= 5, "esperava as 5 rotas públicas conhecidas");
    for (const literal of literals) {
      const probe = literal.endsWith("/") ? `${literal}teste` : literal;
      assert.equal(createEnv({ native: true, path: probe }).overlays().length, 0, `rota pública ${probe} (App.tsx) não pode tocar a motion de launch`);
    }
  }

  // ===== ONBOARDING COMPLETION =====
  {
    const countSats = (html: string) => (html.match(/class="rsm-sat"/g) ?? []).length;
    const play = (variant?: string, options: EnvOptions = {}) => {
      const env = createEnv(options);
      const done = env.win.rsMotion.play("complete", variant) as Promise<Result>;
      return { env, done };
    };

    const products = play("products");
    assert.equal(products.env.overlays()[0].attrs["data-scene"], "complete");
    assert.equal(countSats(products.env.overlays()[0].innerHTML), 4);
    assert.match(products.env.overlays()[0].innerHTML, /Tudo pronto/);
    assert.match(products.env.overlays()[0].innerHTML, /M4 4h7v7H4z/, "products: catálogo");
    assert.doesNotMatch(products.env.overlays()[0].innerHTML, /M4 6h16v14H4z/, "products: sem agenda");

    const services = play("services");
    assert.equal(countSats(services.env.overlays()[0].innerHTML), 4);
    assert.match(services.env.overlays()[0].innerHTML, /M4 6h16v14H4z/, "services: agenda");
    assert.doesNotMatch(services.env.overlays()[0].innerHTML, /M4 4h7v7H4z/, "services: sem catálogo");

    assert.equal(countSats(play("both").env.overlays()[0].innerHTML), 5, "both: combinação provisória");
    assert.equal(countSats(play("qualquer-coisa").env.overlays()[0].innerHTML), 4, "variante inválida cai em products, nunca lança");
    assert.equal(countSats(play().env.overlays()[0].innerHTML), 4, "sem variante cai em products");

    // Duração fixa e SEM depender de "app pronto": é só apresentação.
    const fixed = play("products");
    fixed.env.clock.advance(timing.complete.min - 1);
    assert.equal(fixed.env.phase(), "run", "antes da duração fixa, ainda tocando");
    fixed.env.clock.advance(1);
    assert.equal(fixed.env.phase(), "exit", "conclusão sai por tempo, sem ready()");
    fixed.env.clock.advance(EXIT);
    assert.equal(fixed.env.overlays().length, 0);
    assert.equal((await fixed.done).reason, "complete");

    const reduced = play("products", { reduced: true });
    reduced.env.clock.advance(timing.complete.reduced.min);
    assert.equal(reduced.env.phase(), "exit", "reduced: conclusão vira fade curto");
  }

  // ===== UNMOUNT CLEANUP =====
  {
    const env = createEnv(forced);
    const done = env.win.rsMotion.play("launch") as Promise<Result>;
    assert.ok(env.clock.pending() > 0);
    env.win.rsMotion.cancel();
    assert.equal(env.overlays().length, 0, "cancel remove o overlay na hora");
    assert.equal(env.clock.pending(), 0, "cancel limpa TODOS os timers");
    assert.equal((await done).reason, "cancel");
    env.win.rsMotion.cancel(); // ocioso: no-op
    env.win.rsMotion.ready(); // ocioso: no-op
    env.win.rsMotion.ready(); // idempotente
    assert.equal(env.overlays().length, 0);

    // Depois de cancelar, é possível tocar de novo (single-flight foi liberado).
    env.win.rsMotion.play("complete", "products");
    assert.equal(env.overlays().length, 1);

    // Fim natural também não deixa timer pendente.
    const natural = createEnv(forced);
    natural.win.rsMotion.ready();
    natural.clock.advance(MIN + EXIT);
    assert.equal(natural.overlays().length, 0);
    assert.equal(natural.clock.pending(), 0, "fim natural não deixa timers pendentes");
  }

  // ===== FALHA ABERTA =====
  {
    const env = createEnv({ failCreateElement: true });
    const result = (await env.win.rsMotion.play("launch")) as Result;
    assert.equal(result.reason, "error", "se não dá para desenhar, o app aparece normal (nunca lança)");
    assert.equal(env.overlays().length, 0);
  }

  // ===== Acessibilidade e CSS =====
  {
    const env = createEnv(forced);
    assert.equal(env.overlays()[0].attrs["aria-hidden"], "true", "overlay é decorativo: leitores de tela seguem no app real");
    const css = env.styleText();
    assert.doesNotMatch(css, /infinite/, "nenhuma animação em loop infinito");
    assert.match(css, /rsm-fs 0s linear 3s forwards/, "failsafe CSS: esconde o overlay em 3s mesmo se o JS falhar");
    assert.match(css, /pointer-events:none/, "o failsafe também libera o toque");
    assert.match(css, /prefers-reduced-motion:reduce/);
  }

  // ===== Bootstrap do index.html (executado de verdade) =====
  {
    const html = read("client/index.html");
    const match = html.match(/<script>\s*\/\*\s*MOTION-SYSTEM-01[\s\S]*?\*\/([\s\S]*?)<\/script>/);
    assert.ok(match, "bootstrap MOTION-SYSTEM-01 precisa existir no index.html");
    const bootstrap = match![1];
    interface BootOptions { path?: string; search?: string; native?: boolean; webview?: boolean; standalone?: boolean }
    const run = (o: BootOptions = {}) => {
      const written: string[] = [];
      const win: any = {
        location: { pathname: o.path ?? "/", search: o.search ?? "" },
        navigator: { userAgent: o.webview ? "Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36" : "Mozilla/5.0 (Linux; Android 14)" },
        matchMedia: (query: string) => ({ matches: query.includes("display-mode: standalone") ? Boolean(o.standalone) : false }),
        document: { write: (chunk: string) => written.push(chunk) },
      };
      if (o.native) win.Capacitor = { isNativePlatform: () => true };
      win.window = win;
      vm.createContext(win);
      vm.runInContext(bootstrap, win);
      return { win, written };
    };

    // Só carrega o motor onde ele pode tocar: app instalado ou QA forçado. Web comum não paga nada.
    assert.equal(run().written.length, 0, "navegador comum: motor nem é baixado");
    assert.equal(run({ native: true }).written.length, 1, "WebView Capacitor: carrega");
    assert.equal(run({ webview: true }).written.length, 1, "WebView Android (UA wv): carrega");
    assert.equal(run({ standalone: true }).written.length, 1, "PWA/TWA instalado: carrega");
    assert.equal(run({ search: "?launch-motion=1" }).written.length, 1, "?launch-motion=1 força o carregamento (QA)");
    assert.equal(run({ native: true, search: "?launch-motion=0" }).written.length, 0, "?launch-motion=0 desliga");
    assert.equal(run({ native: true, path: "/u/minha-loja" }).written.length, 0, "catálogo público nunca carrega o motor");
    assert.equal(run({ native: true, path: "/sorteio/abc" }).written.length, 0, "sorteio público nunca carrega o motor");

    const loaded = run({ native: true });
    assert.match(loaded.written[0], /^<script src="\/motion\/revendasmart-motion\.v2\.js" /, "carregamento síncrono (document.write): a motion pinta ANTES de o React montar");
    assert.doesNotMatch(html, /revendasmart-motion\.v1\.js/, "bootstrap não carrega mais a v1 (SW cache-first: nome versionado novo invalida o cache)");
    assert.doesNotMatch(loaded.written[0], /\basync\b|\bdefer\b/, "nunca async/defer: ordem de execução garantida antes do bundle");
    assert.match(loaded.written[0], /onerror="window\.rsMotion=void 0"/, "falha de carregamento: sem motor, window.rsMotion some e o app segue normal");
    assert.equal(typeof loaded.win.rsMotion.ready, "function");
    loaded.win.rsMotion.ready();
    assert.equal(loaded.win.rsMotion.r, 1, "stub guarda o ready que chegou antes do motor");
    loaded.win.rsMotion.play("complete", "products"); // stub: no-op, nunca lança

    // Rotas públicas do bootstrap (catálogo/sorteio) espelham a lista de App.tsx para essas duas famílias.
    const appPublic = read("client/src/App.tsx");
    assert.match(appPublic, /path\.startsWith\("\/u\/"\)/);
    assert.match(appPublic, /path\.startsWith\("\/sorteio\/"\)/);

    assert.ok(fs.existsSync(MOTION_FILE), "arquivo versionado referenciado pelo bootstrap precisa existir");
    // v1 fica publicado como baseline histórico e não é editado (cache-first do SW); a v2 tem marcador próprio.
    assert.ok(fs.existsSync(MOTION_V1_FILE), "v1 preservada como baseline");
    assert.match(read(MOTION_V1_FILE), /version: 1,/);
    assert.match(read(MOTION_V1_FILE), /"rs:launch-motion:v1"/);
    assert.match(motionSource, /"rs:launch-motion:v2"/);
    assert.doesNotMatch(motionSource, /"rs:launch-motion:v1"/, "marcador de sessão versionado: sem colisão com a v1");

    // O motor roda durante o parse do <head>: ainda não existe <body>. O overlay vai para o <html>.
    const early = createEnv({ ...forced, noBody: true });
    assert.equal(early.overlays().length, 1, "sem body ainda (script síncrono no head), o overlay é criado mesmo assim");
  }

  // ===== MOTION != BOOTSTRAP AUTHORITY / sem chamadas duplicadas (guardas de código-fonte) =====
  {
    const engine = stripComments(motionSource);
    for (const forbidden of [
      /\bfetch\s*\(/, /XMLHttpRequest/, /sendBeacon/, /WebSocket/, /indexedDB/, /localStorage/, /firebase/i,
      /getIdToken/, /Authorization/, /\/api\//, /onAuthStateChanged/, /businessMode/, /premium/i, /tenant/i,
      /\.mp4|\.webm|\.gif|lottie|rive\b/i,
      // Zero áudio: sem música, sting, whoosh, Audio API ou arquivo de som.
      /\baudio\b|new Audio|AudioContext|webkitAudioContext|speechSynthesis|\.mp3|\.wav|\.ogg|\.m4a|\.aac/i,
      // Sem dependência de animação nem import: só CSS/DOM nativos.
      /\bimport\b|\brequire\s*\(|gsap|framer|anime\.js|particles/i,
    ]) {
      assert.doesNotMatch(engine, forbidden, `o motor não pode tocar ${forbidden}: motion não é autoridade de bootstrap`);
    }
    assert.doesNotMatch(motionSource, /\bease-(in|out|in-out|linear)\b/, "tokens ease-* no motor viram utilitários no CSS global (Tailwind v4 varre client/public) e gastam o orçamento de CSS — use cubic-bezier");

    const bridge = read("client/src/lib/motion-bridge.ts");
    const launchReady = read("client/src/components/LaunchReady.tsx");
    for (const [name, source] of [["motion-bridge.ts", bridge], ["LaunchReady.tsx", launchReady]] as const) {
      const code = stripComments(source);
      assert.doesNotMatch(code, /onAuthStateChanged|getFirebaseAuth|\bfetch\s*\(|apiRequest|getIdToken|localStorage|getApiUrl/, `${name} não pode criar listener de auth nem fetch`);
    }
    assert.match(launchReady, /useUserSettings\(\)/);
    assert.match(launchReady, /usePlan\(\)/);
    assert.match(launchReady, /const ready = !settingsLoading && !planLoading;/, "prontidão = settings E plano deixaram de carregar (estado já existente)");
    assert.match(launchReady, /\[ready\]/);

    // Nenhum listener de auth novo: contagens idênticas ao baseline nos três pontos de bootstrap.
    const count = (path: string) => (read(path).match(/onAuthStateChanged\(/g) ?? []).length;
    assert.equal(count("client/src/routers/PrivateRouter.tsx"), 1);
    assert.equal(count("client/src/hooks/useUserSettings.ts"), 1);
    assert.equal(count("client/src/providers/PlanProvider.tsx"), 1);

    // Erro permanente nunca prende a motion: os dois hooks de bootstrap resolvem loading=false no finally.
    assert.match(read("client/src/hooks/useUserSettings.ts"), /finally \{\s*if \(isMounted\) \{\s*setLoading\(false\);/);
    assert.match(read("client/src/providers/PlanProvider.tsx"), /finally \{\s*setLoading\(false\);/);

    // LaunchReady é montado uma vez, DENTRO dos providers que ele observa.
    const router = read("client/src/routers/PrivateRouter.tsx");
    assert.match(router, /<PlanProvider>\s*<LaunchReady \/>\s*<PrivateRoutes \/>\s*<\/PlanProvider>/);
    assert.equal((router.match(/<LaunchReady/g) ?? []).length, 1);
  }

  // ===== Onboarding: gatilho só na conclusão, sem await, sem autoridade =====
  {
    const onboarding = read("client/src/pages/onboarding.tsx");
    assert.equal((onboarding.match(/playOnboardingCompletionMotion\(/g) ?? []).length, 1, "um único gatilho");
    const complete = onboarding.match(/const handleComplete = [\s\S]*?\n {2}\}\);/)![0];
    assert.match(complete, /await saveProgress\(\{ completed: true \}\);[\s\S]*playOnboardingCompletionMotion\("products"\);\s*setLocation\(destination\);/, "motion só depois do save confirmado e antes de navegar");
    assert.doesNotMatch(onboarding, /await playOnboardingCompletionMotion/, "a navegação nunca espera pela motion");
    const skip = onboarding.match(/const handleSkip = [\s\S]*?\n {2}\}\);/)![0];
    const later = onboarding.match(/const handleContinueLater = [\s\S]*?\n {2}\}\);/)![0];
    assert.doesNotMatch(skip + later, /playOnboardingCompletionMotion/, "pular/continuar depois não é conclusão");
    assert.doesNotMatch(stripComments(onboarding), /businessMode/, "não existe businessMode no app: nada inventado");
  }

  // ===== Sem dependências/asset pesado novos =====
  {
    const pkg = JSON.parse(read("package.json"));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    assert.equal(deps.filter((d) => /lottie|rive|gsap|particles|howler|^tone$/i.test(d)).length, 0, "Rive/Lottie/GSAP/partículas/áudio não são instalados");
    for (const src of [SYMBOL_SRC, LOCKUP_SRC]) {
      assert.ok(fs.existsSync(`client/public${src}`), `asset de marca usado pelo motor precisa existir: ${src}`);
    }
    const assets = new Set(motionSource.match(/\/[\w./-]+\.(?:png|jpe?g|webp|svg|avif|mp4|webm|gif|json|riv|lottie)\b/g));
    assert.deepEqual([...assets].sort(), [LOCKUP_SRC, SYMBOL_SRC].sort(), "únicos assets: os PNGs oficiais já versionados (nenhum vídeo/Envato/AEP)");
    assert.equal(fs.readdirSync("client/public/motion").filter((f) => !/^revendasmart-motion\.v\d+\.js$/.test(f)).length, 0, "nada além dos motores versionados em client/public/motion");
  }

  console.log("motion-system tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
