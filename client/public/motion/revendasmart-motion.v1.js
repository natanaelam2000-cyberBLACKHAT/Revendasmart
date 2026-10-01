/*!
 * RevendaSmart Motion System v1 (REVENDASMART FLOW) — MOTION-SYSTEM-01.
 *
 * Camada puramente APRESENTACIONAL: HTML/CSS/SVG leve + um controlador de tempo. Carregada por um
 * bootstrap inline em client/index.html (fora do bundle Vite, para não gastar o orçamento de JS).
 *
 * MOTION != BOOTSTRAP AUTHORITY. Este arquivo:
 *   - NÃO faz rede, NÃO lê/escreve auth, settings, plano, tenant nem localStorage;
 *   - NÃO decide se o app está pronto: só RECEBE o sinal `ready()` que o React já derivou do estado
 *     existente (client/src/components/LaunchReady.tsx) e o usa para saber quando PODE sair;
 *   - NUNCA segura o app: o app é montado por baixo em paralelo; o overlay só cobre. Em MAX ele sai
 *     de qualquer jeito e o loader/erro real do app (já fail-closed) fica visível.
 *
 * Para mudar o arquivo, publique um NOVO nome (v2) e atualize o bootstrap — o service worker serve
 * scripts same-origin em cache-first, então o nome versionado é o mecanismo de invalidação.
 */
(function (w, d) {
  "use strict";
  if (w.rsMotion && w.rsMotion.version) return; // idempotente

  // O bootstrap deixa um stub { ready, play } e guarda `r = 1` se o React reportou ready antes de
  // este script carregar. Lemos esse flag uma vez e assumimos a API real.
  var preReady = !!(w.rsMotion && w.rsMotion.r);

  // ---- Tempo (ms) ---------------------------------------------------------------------------
  // min    : primeira saída possível (símbolo já formado). Nunca sai antes disso.
  // target : fim natural da sequência; depois disso o último quadro fica parado (hold).
  // max    : teto absoluto. Sai mesmo sem app pronto; o loader/erro real do app assume.
  var PROFILES = {
    launch: { wait: true, min: 900, target: 1800, max: 2500, reduced: { min: 300, target: 300, max: 1200 } },
    complete: { wait: false, min: 1500, target: 1500, max: 1500, reduced: { min: 450, target: 450, max: 450 } },
  };
  var EXIT_MS = 260;

  // Ícones apresentacionais (24x24, traço). Substituíveis no passe visual sem tocar na lógica.
  var ICONS = {
    product: "M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8",
    client: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c0-4 3.6-6 8-6s8 2 8 6",
    sale: "M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v10M15 9.5c-.6-1-1.7-1.5-3-1.5-1.7 0-3 .8-3 2s1.3 1.7 3 2 3 .8 3 2-1.3 2-3 2c-1.3 0-2.4-.5-3-1.5",
    order: "M9 4h6v3H9zM7 5.5H5.5v15h13v-15H17M9 12h6M9 16h4",
    agenda: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
    service: "M14.7 6.3a4 4 0 00-5 5L3 18l3 3 6.7-6.7a4 4 0 005-5l-2.5 2.5-2.2-.5-.5-2.2z",
    work: "M3 8h18v12H3zM9 8V5h6v3M3 13h18",
    catalog: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  };

  // Conteúdo por cena. Só apresentação: nada aqui concede rota/plano/modo.
  var ITEMS = {
    launch: ["product", "client", "sale", "order", "agenda"],
    products: ["product", "client", "sale", "catalog"],
    services: ["agenda", "client", "service", "work"],
    both: ["product", "client", "sale", "agenda", "service"], // combinação provisória
  };

  // Mesmas rotas públicas de client/src/App.tsx (isPublicPath). Motion de launch nunca roda nelas.
  function isPublicPath(p) {
    return p === "/login" || p === "/signup" || p === "/account-deletion" || p.indexOf("/u/") === 0 || p.indexOf("/sorteio/") === 0;
  }

  var CSS =
    ".rsm{--rsm-p:#4c16ad;--rsm-g:#d4af37;--rsm-r:92px;position:fixed;inset:0;z-index:2147483000;overflow:hidden;isolation:isolate;" +
    "background:#fbf9ff;color:var(--rsm-p);font:600 17px/1.3 Outfit,system-ui,sans-serif;animation:rsm-fs 0s linear 3s forwards}" +
    ".rsm *{box-sizing:border-box}" +
    ".rsm-stage{position:absolute;inset:0}" +
    ".rsm-halo,.rsm-dot,.rsm-sat,.rsm-mark,.rsm-check{position:absolute;left:50%;top:50%}" +
    ".rsm-halo{width:320px;height:320px;margin:-160px;border-radius:50%;background:radial-gradient(closest-side,rgba(76,22,173,.1),rgba(76,22,173,0));opacity:0;animation:rsm-halo 1.8s cubic-bezier(0,0,.2,1) both}" +
    ".rsm-dot{width:14px;height:14px;margin:-7px;border-radius:50%;background:var(--rsm-p);animation:rsm-dot .52s cubic-bezier(0,0,.2,1) both}" +
    ".rsm-sat{--a:calc(var(--i)*360deg/var(--n) - 90deg);width:44px;height:44px;margin:-22px;border-radius:14px;background:#fff;display:grid;place-items:center;opacity:0;" +
    "box-shadow:0 6px 18px rgba(76,22,173,.14),0 0 0 1px rgba(76,22,173,.08);" +
    "animation:rsm-out .34s cubic-bezier(.2,.8,.2,1) calc(120ms + var(--i)*40ms) both,rsm-in .4s cubic-bezier(.6,0,.4,1) calc(460ms + var(--i)*15ms) forwards}" +
    ".rsm-sat svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}" +
    ".rsm-mark{width:132px;height:132px;margin:-66px;clip-path:circle(41%);mix-blend-mode:multiply;opacity:0;animation:rsm-form .4s cubic-bezier(.2,1.1,.3,1) 520ms both,rsm-settle .9s cubic-bezier(.4,0,.2,1) 900ms}" +
    ".rsm-check{width:68px;height:68px;margin:-34px -34px;border-radius:50%;background:var(--rsm-p);display:grid;place-items:center;opacity:0;" +
    "box-shadow:0 0 0 4px #fbf9ff,0 0 0 6px var(--rsm-g);animation:rsm-form .4s cubic-bezier(.2,1.1,.3,1) 520ms both}" +
    ".rsm-check svg{width:34px;height:34px;fill:none;stroke:#fff;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:24;stroke-dashoffset:24;animation:rsm-draw .32s cubic-bezier(0,0,.2,1) 700ms forwards}" +
    ".rsm-msg{position:absolute;left:0;right:0;top:calc(50% + 70px);margin:0;text-align:center;opacity:0;animation:rsm-msg .3s cubic-bezier(0,0,.2,1) 780ms forwards}" +
    ".rsm[data-phase=exit]{animation:rsm-fs 0s linear 3s forwards,rsm-exit " + EXIT_MS + "ms cubic-bezier(.4,0,1,1) forwards}" +
    ".rsm[data-phase=exit] .rsm-stage{animation:rsm-zoom " + EXIT_MS + "ms cubic-bezier(.4,0,1,1) forwards}" +
    "@keyframes rsm-out{from{opacity:0;transform:rotate(var(--a)) translateY(0) rotate(calc(var(--a)*-1)) scale(.4)}to{opacity:1;transform:rotate(var(--a)) translateY(calc(var(--rsm-r)*-1)) rotate(calc(var(--a)*-1)) scale(1)}}" +
    "@keyframes rsm-in{from{opacity:1;transform:rotate(var(--a)) translateY(calc(var(--rsm-r)*-1)) rotate(calc(var(--a)*-1)) scale(1)}to{opacity:0;transform:rotate(var(--a)) translateY(0) rotate(calc(var(--a)*-1)) scale(.35)}}" +
    "@keyframes rsm-dot{0%{opacity:0;transform:scale(.2)}35%,70%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(.5)}}" +
    "@keyframes rsm-form{from{opacity:0;transform:scale(.55)}to{opacity:1;transform:scale(1)}}" +
    "@keyframes rsm-settle{50%{transform:scale(1.04)}}" +
    "@keyframes rsm-halo{0%{opacity:0;transform:scale(.7)}35%{opacity:1;transform:scale(1)}65%{transform:scale(1.08)}100%{opacity:1;transform:scale(1)}}" +
    "@keyframes rsm-draw{to{stroke-dashoffset:0}}" +
    "@keyframes rsm-msg{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}" +
    "@keyframes rsm-exit{to{opacity:0}}" +
    "@keyframes rsm-zoom{to{transform:scale(1.08)}}" +
    "@keyframes rsm-fs{to{visibility:hidden;pointer-events:none}}" +
    "@media (prefers-reduced-motion:reduce){.rsm-dot,.rsm-sat,.rsm-halo{display:none}" +
    ".rsm-mark,.rsm-check{animation:rsm-rfade .15s linear both}.rsm-check svg{animation:none;stroke-dashoffset:0}" +
    ".rsm-msg{animation:rsm-rfade .15s linear both}.rsm[data-phase=exit] .rsm-stage{animation:none}" +
    ".rsm[data-phase=exit]{animation:rsm-fs 0s linear 3s forwards,rsm-exit .15s linear forwards}}" +
    "@keyframes rsm-rfade{from{opacity:0}to{opacity:1}}";

  var styleEl = null;
  var active = null;
  var appReady = preReady;

  function nowMs() {
    return w.performance && typeof w.performance.now === "function" ? w.performance.now() : Date.now();
  }

  function prefersReduced() {
    try {
      return !!(w.matchMedia && w.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch (e) {
      return false;
    }
  }

  function icon(id) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + ICONS[id] + '"/></svg>';
  }

  function markup(scene, items) {
    var n = items.length;
    var h = '<div class="rsm-halo"></div><div class="rsm-stage"><i class="rsm-dot"></i>';
    for (var i = 0; i < n; i++) {
      h += '<span class="rsm-sat" style="--i:' + i + ";--n:" + n + '">' + icon(items[i]) + "</span>";
    }
    if (scene === "launch") {
      h += '<img class="rsm-mark" src="/logo-revenda-smart-symbol-official.png" alt="" decoding="async">';
    } else {
      h +=
        '<span class="rsm-check"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg></span>' +
        '<p class="rsm-msg">Tudo pronto</p>';
    }
    return h + "</div>";
  }

  /**
   * Toca uma cena. Single-flight: se já há uma ativa devolve a mesma promise (nunca empilha overlays).
   * Resolve SEMPRE (nunca rejeita, nunca fica pendente além de max + EXIT_MS) com { reason, ms }.
   * `scene`: "launch" | "complete". `variant` (só "complete"): "products" | "services" | "both".
   */
  function play(scene, variant) {
    if (active) return active.promise;
    if (scene !== "launch") scene = "complete";
    var profile = PROFILES[scene];
    var reduced = prefersReduced();
    var t = reduced ? profile.reduced : profile;
    var key = scene === "launch" ? "launch" : ITEMS[variant] ? variant : "products";

    var el = null;
    var timers = [];
    var finished = false;
    var exiting = false;
    var resolveFn;
    var promise = new Promise(function (resolve) {
      resolveFn = resolve;
    });
    var t0 = nowMs();

    try {
      el = d.createElement("div");
      if (!styleEl) {
        styleEl = d.createElement("style");
        styleEl.textContent = CSS;
        d.head.appendChild(styleEl);
      }
      el.className = "rsm";
      el.setAttribute("data-scene", scene);
      el.setAttribute("data-phase", "run");
      if (reduced) el.setAttribute("data-reduced", "1");
      el.setAttribute("aria-hidden", "true");
      el.innerHTML = markup(scene, ITEMS[key]);
      (d.body || d.documentElement).appendChild(el);
    } catch (e) {
      // Falha aberta: se não conseguimos desenhar, o app simplesmente aparece normal.
      if (el && el.remove) el.remove();
      return Promise.resolve({ reason: "error", ms: 0 });
    }

    function clearTimers() {
      while (timers.length) w.clearTimeout(timers.pop());
    }

    function finish(reason) {
      if (finished) return;
      finished = true;
      clearTimers();
      if (el.remove) el.remove();
      if (active && active.el === el) active = null;
      resolveFn({ reason: reason, ms: Math.round(nowMs() - t0) });
    }

    function exit(reason) {
      if (exiting || finished) return;
      exiting = true;
      clearTimers();
      el.setAttribute("data-phase", "exit");
      timers.push(w.setTimeout(function () { finish(reason); }, EXIT_MS));
    }

    function evaluate() {
      if (exiting || finished) return;
      var e = nowMs() - t0;
      var ready = !profile.wait || appReady;
      if (ready && e >= t.min) exit(profile.wait ? "ready" : "complete");
      else if (e >= t.max) exit("max");
    }

    timers.push(w.setTimeout(evaluate, t.min));
    timers.push(w.setTimeout(evaluate, t.max));
    timers.push(w.setTimeout(function () {
      if (!exiting && !finished) el.setAttribute("data-phase", "hold");
    }, t.target));

    active = { el: el, promise: promise, evaluate: evaluate, cancel: function () { finish("cancel"); } };
    return promise;
  }

  function markCold() {
    try {
      w.sessionStorage.setItem("rs:launch-motion:v1", "1");
    } catch (e) { /* sem sessionStorage: tocamos mesmo assim, uma vez por documento */ }
  }

  function alreadyPlayedThisSession() {
    try {
      return w.sessionStorage.getItem("rs:launch-motion:v1") === "1";
    } catch (e) {
      return false;
    }
  }

  function isAppShell() {
    try {
      var cap = w.Capacitor;
      if (cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform()) return true;
      if (/; wv\)/.test((w.navigator && w.navigator.userAgent) || "")) return true;
      return !!(w.matchMedia && w.matchMedia("(display-mode: standalone)").matches);
    } catch (e) {
      return false;
    }
  }

  // COLD START = este script rodando num documento novo. Voltar do background / trocar aba /
  // navegar / abrir modal NÃO recarregam o documento, então este bloco nunca roda de novo (e não há
  // listener de visibilidade/lifecycle que pudesse repetir). O marcador de sessão cobre só o reload
  // do mesmo WebView/aba (ex.: atualização de versão), que não é um cold start de verdade.
  function autoLaunch() {
    var search = (w.location && w.location.search) || "";
    if (/[?&]launch-motion=0(&|$)/.test(search)) return;
    if (isPublicPath((w.location && w.location.pathname) || "/")) return;
    var forced = /[?&]launch-motion=1(&|$)/.test(search);
    if (!forced && (!isAppShell() || alreadyPlayedThisSession())) return;
    markCold();
    play("launch");
  }

  w.rsMotion = {
    version: 1,
    play: play,
    // Chamado pelo React quando o estado JÁ EXISTENTE (settings + plano) deixou de carregar. É um
    // latch: só vai de false para true e só libera a SAÍDA da motion; nunca altera o app.
    ready: function () {
      appReady = true;
      if (active) active.evaluate();
    },
    cancel: function () {
      if (active) active.cancel();
    },
    timing: { launch: PROFILES.launch, complete: PROFILES.complete, exitMs: EXIT_MS },
  };

  autoLaunch();
})(window, document);
