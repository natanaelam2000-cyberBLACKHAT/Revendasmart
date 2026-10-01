/*!
 * RevendaSmart Motion System v2 — RS-MOTION-02 (sobre a arquitetura de MOTION-SYSTEM-01).
 *
 * Camada puramente APRESENTACIONAL: HTML/CSS leve + um controlador de tempo. Carregada por um
 * bootstrap inline em client/index.html (fora do bundle Vite, para não gastar o orçamento de JS).
 *
 * MOTION != BOOTSTRAP AUTHORITY. Este arquivo:
 *   - NÃO faz rede, NÃO lê/escreve auth, settings, plano, tenant nem localStorage;
 *   - NÃO decide se o app está pronto: só RECEBE o sinal `ready()` que o React já derivou do estado
 *     existente (client/src/components/LaunchReady.tsx) e o usa para saber quando PODE sair;
 *   - NUNCA segura o app: o app é montado por baixo em paralelo; o overlay só cobre. Em MAX ele sai
 *     de qualquer jeito e o loader/erro real do app (já fail-closed) fica visível.
 *
 * Launch v2 = brand reveal: SÍMBOLO (sozinho, grande) → SÍMBOLO + "Revenda Smart" → app real.
 * O símbolo é um único elemento do começo ao fim (shared element): ele reduz e desliza até a posição
 * exata do símbolo no lockup oficial, enquanto o nome sai de trás dele. Só transform/opacity animam
 * (compositor), então a motion não trava enquanto o React monta por baixo.
 *
 * O v1 continua publicado como baseline. Para mudar ESTE arquivo, publique um NOVO nome (v3) e
 * atualize o bootstrap — o service worker serve scripts same-origin em cache-first.
 */
/* global window, document */
(function (w, d) {
  "use strict";
  if (w.rsMotion && w.rsMotion.version) return; // idempotente

  // O bootstrap deixa um stub { ready, play } e guarda `r = 1` se o React reportou ready antes de
  // este script carregar. Lemos esse flag uma vez e assumimos a API real.
  var preReady = !!(w.rsMotion && w.rsMotion.r);

  // ---- Tempo (ms) ---------------------------------------------------------------------------
  // min    : primeira saída possível. Na launch, o lockup completo já está parado desde brand+reveal.
  // target : fim natural da sequência; depois disso o último quadro fica parado (hold).
  // max    : teto absoluto. Sai mesmo sem app pronto; o loader/erro real do app assume.
  // brand  : (launch) início da transformação símbolo → lockup; reveal: duração dela.
  var SYMBOL_MS = 560;
  var MOVE_MS = 500;
  var NAME_DELAY_MS = 70;
  var NAME_MS = 460;
  var PROFILES = {
    launch: {
      wait: true, min: 1450, target: 1450, max: 2500, brand: 540, reveal: Math.max(MOVE_MS, NAME_DELAY_MS + NAME_MS),
      reduced: { min: 1000, target: 1000, max: 1500, brand: 360, reveal: 290 },
    },
    complete: { wait: false, min: 1500, target: 1500, max: 1500, reduced: { min: 450, target: 450, max: 450 } },
  };
  var EXIT_MS = 260;

  // Ícones apresentacionais (24x24, traço) — só da cena de conclusão do onboarding.
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

  // Conteúdo da conclusão por modo. Só apresentação: nada aqui concede rota/plano/modo.
  var ITEMS = {
    products: ["product", "client", "sale", "catalog"],
    services: ["agenda", "client", "service", "work"],
    both: ["product", "client", "sale", "agenda", "service"], // combinação provisória
  };

  // Assets oficiais versionados (já pré-cacheados pelo service worker). Nada é redesenhado.
  var SYMBOL_SRC = "/logo-revenda-smart-symbol-official.png";
  var LOCKUP_SRC = "/logo-revenda-smart-official.png";

  // Mesmas rotas públicas de client/src/App.tsx (isPublicPath). Motion de launch nunca roda nelas.
  function isPublicPath(p) {
    return p === "/login" || p === "/signup" || p === "/account-deletion" || p.indexOf("/u/") === 0 || p.indexOf("/sorteio/") === 0;
  }

  // Geometria da launch, em pixels do PNG do lockup (1254x1254) — `--u` = 1 px do lockup na tela.
  // Medida por registro de imagem entre os dois PNGs oficiais (símbolo 1254² → lockup: escala
  // 0,29025, deslocamento 77,25/434,5). Âncora no centro da tela = centro do conteúdo do lockup
  // (x 639,5) na altura do centro do aro dourado (y 613,3). O lockup final ocupa 76vmin (máx. 400px);
  // o símbolo sozinho ocupa 31vmin (aro externo), ~1,45x o tamanho que terá no lockup.
  //   símbolo (img 529,4u, aro em 49,8%/49,12%) → translateX(-380u) scale(.6945) = aro do lockup (r 150,7)
  //   nome: janela que acompanha o centro do símbolo (rsm-wm/rsm-wc) + recorte só do texto (x ≥ 432)
  //   nome em mix-blend-mode:darken: o fundo do PNG (252–255) vira o fundo do overlay e roxo/dourado
  //   ficam byte a byte (multiply deixava uma caixa ~1% mais escura)
  function u(n) {
    return "calc(var(--u)*" + n + ")";
  }
  var EASE_MOVE = "cubic-bezier(.65,0,.35,1)";

  var CSS =
    ".rsm{--rsm-p:#4c16ad;--rsm-g:#d4af37;--rsm-r:92px;--u:calc(76vmin/1064);position:fixed;inset:0;z-index:2147483000;overflow:hidden;isolation:isolate;" +
    "background:#fbf9ff;color:var(--rsm-p);font:600 17px/1.3 Outfit,system-ui,sans-serif;animation:rsm-fs 0s linear 3s forwards}" +
    "@supports (width:min(1px,2px)){.rsm{--u:calc(min(76vmin,400px)/1064)}}" +
    ".rsm *{box-sizing:border-box}" +
    ".rsm-stage{position:absolute;inset:0}" +
    // ---- launch: brand reveal --------------------------------------------------------------
    ".rsm[data-scene=launch] .rsm-stage{background:inherit}" +
    ".rsm-brand{position:absolute;left:50%;top:50%;width:0;height:0}" +
    ".rsm-brand img{position:absolute;display:block;max-width:none}" +
    ".rsm-hero{position:absolute;left:" + u(-263.65) + ";top:" + u(-260.06) + ";width:" + u(529.4) + ";height:" + u(529.4) + ";transform-origin:49.8% 49.12%}" +
    ".rsm-sym{left:0;top:0;width:100%;height:100%;clip-path:circle(41.2% at 49.8% 49.12%);transform-origin:49.8% 49.12%;opacity:0;" +
    "animation:rsm-sym " + SYMBOL_MS + "ms cubic-bezier(.16,1,.3,1) both,rsm-fade 280ms cubic-bezier(.4,0,.2,1) both}" +
    ".rsm-wm{position:absolute;left:" + u(-380) + ";top:" + u(-53.3) + ";width:" + u(930.5) + ";height:" + u(112) + ";overflow:hidden;mix-blend-mode:darken;" +
    "visibility:hidden;transform:translateX(" + u(380) + ")}" +
    ".rsm-wc{position:absolute;left:0;top:0;transform:translateX(" + u(-380) + ")}" +
    ".rsm-wt{position:absolute;left:" + u(172.5) + ";top:0;width:" + u(758) + ";height:" + u(112) + ";overflow:hidden;transform:translateX(" + u(-420) + ")}" +
    ".rsm-wt img{left:" + u(-432) + ";top:" + u(-560) + ";width:" + u(1254) + ";height:" + u(1254) + "}" +
    ".rsm-brand .rsm-full{display:none;left:" + u(-639.5) + ";top:" + u(-613.3) + ";width:" + u(1254) + ";height:" + u(1254) + ";mix-blend-mode:darken}" +
    ".rsm[data-step=brand] .rsm-hero{animation:rsm-move " + MOVE_MS + "ms " + EASE_MOVE + " both}" +
    ".rsm[data-step=brand] .rsm-wm{visibility:visible;animation:rsm-track " + MOVE_MS + "ms " + EASE_MOVE + " both}" +
    ".rsm[data-step=brand] .rsm-wc{animation:rsm-counter " + MOVE_MS + "ms " + EASE_MOVE + " both}" +
    ".rsm[data-step=brand] .rsm-wt{animation:rsm-name " + NAME_MS + "ms cubic-bezier(.2,.7,.2,1) " + NAME_DELAY_MS + "ms both}" +
    // Saída: a marca se dissolve primeiro sobre o fundo limpo; depois o fundo revela o app (sem a marca
    // "fantasma" por cima da interface). Total = EXIT_MS.
    ".rsm[data-scene=launch][data-phase=exit]{animation:rsm-fs 0s linear 3s forwards,rsm-exit " + (EXIT_MS - 60) + "ms cubic-bezier(.4,0,.2,1) 60ms forwards}" +
    ".rsm[data-scene=launch][data-phase=exit] .rsm-stage{animation:rsm-lift 140ms cubic-bezier(.4,0,.2,1) forwards}" +
    "@keyframes rsm-sym{from{transform:scale(.9)}to{transform:none}}" +
    "@keyframes rsm-fade{from{opacity:0}to{opacity:1}}" +
    "@keyframes rsm-move{to{transform:translateX(" + u(-380) + ") scale(.6945)}}" +
    "@keyframes rsm-track{from{transform:translateX(" + u(380) + ")}to{transform:none}}" +
    "@keyframes rsm-counter{from{transform:translateX(" + u(-380) + ")}to{transform:none}}" +
    "@keyframes rsm-name{from{transform:translateX(" + u(-420) + ")}to{transform:none}}" +
    "@keyframes rsm-lift{to{opacity:0;transform:scale(1.03)}}" +
    // ---- complete: conclusão do onboarding (inalterada desde a v1) -------------------------
    ".rsm-halo,.rsm-dot,.rsm-sat,.rsm-check{position:absolute;left:50%;top:50%}" +
    ".rsm-halo{width:320px;height:320px;margin:-160px;border-radius:50%;background:radial-gradient(closest-side,rgba(76,22,173,.1),rgba(76,22,173,0));opacity:0;animation:rsm-halo 1.8s cubic-bezier(0,0,.2,1) both}" +
    ".rsm-dot{width:14px;height:14px;margin:-7px;border-radius:50%;background:var(--rsm-p);animation:rsm-dot .52s cubic-bezier(0,0,.2,1) both}" +
    ".rsm-sat{--a:calc(var(--i)*360deg/var(--n) - 90deg);width:44px;height:44px;margin:-22px;border-radius:14px;background:#fff;display:grid;place-items:center;opacity:0;" +
    "box-shadow:0 6px 18px rgba(76,22,173,.14),0 0 0 1px rgba(76,22,173,.08);" +
    "animation:rsm-out .34s cubic-bezier(.2,.8,.2,1) calc(120ms + var(--i)*40ms) both,rsm-in .4s cubic-bezier(.6,0,.4,1) calc(460ms + var(--i)*15ms) forwards}" +
    ".rsm-sat svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}" +
    ".rsm-check{width:68px;height:68px;margin:-34px -34px;border-radius:50%;background:var(--rsm-p);display:grid;place-items:center;opacity:0;" +
    "box-shadow:0 0 0 4px #fbf9ff,0 0 0 6px var(--rsm-g);animation:rsm-form .4s cubic-bezier(.2,1.1,.3,1) 520ms both}" +
    ".rsm-check svg{width:34px;height:34px;fill:none;stroke:#fff;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:24;stroke-dashoffset:24;animation:rsm-draw .32s cubic-bezier(0,0,.2,1) 700ms forwards}" +
    ".rsm-msg{position:absolute;left:0;right:0;top:calc(50% + 70px);margin:0;text-align:center;opacity:0;animation:rsm-msg .3s cubic-bezier(0,0,.2,1) 780ms forwards}" +
    ".rsm[data-phase=exit]{animation:rsm-fs 0s linear 3s forwards,rsm-exit " + EXIT_MS + "ms cubic-bezier(.4,0,1,1) forwards}" +
    ".rsm[data-scene=complete][data-phase=exit] .rsm-stage{animation:rsm-zoom " + EXIT_MS + "ms cubic-bezier(.4,0,1,1) forwards}" +
    "@keyframes rsm-out{from{opacity:0;transform:rotate(var(--a)) translateY(0) rotate(calc(var(--a)*-1)) scale(.4)}to{opacity:1;transform:rotate(var(--a)) translateY(calc(var(--rsm-r)*-1)) rotate(calc(var(--a)*-1)) scale(1)}}" +
    "@keyframes rsm-in{from{opacity:1;transform:rotate(var(--a)) translateY(calc(var(--rsm-r)*-1)) rotate(calc(var(--a)*-1)) scale(1)}to{opacity:0;transform:rotate(var(--a)) translateY(0) rotate(calc(var(--a)*-1)) scale(.35)}}" +
    "@keyframes rsm-dot{0%{opacity:0;transform:scale(.2)}35%,70%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(.5)}}" +
    "@keyframes rsm-form{from{opacity:0;transform:scale(.55)}to{opacity:1;transform:scale(1)}}" +
    "@keyframes rsm-halo{0%{opacity:0;transform:scale(.7)}35%{opacity:1;transform:scale(1)}65%{transform:scale(1.08)}100%{opacity:1;transform:scale(1)}}" +
    "@keyframes rsm-draw{to{stroke-dashoffset:0}}" +
    "@keyframes rsm-msg{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}" +
    "@keyframes rsm-exit{to{opacity:0}}" +
    "@keyframes rsm-zoom{to{transform:scale(1.08)}}" +
    "@keyframes rsm-fs{to{visibility:hidden;pointer-events:none}}" +
    // ---- prefers-reduced-motion: sem trajetória nem zoom; só fades curtos ---------------------
    "@media (prefers-reduced-motion:reduce){.rsm-dot,.rsm-sat,.rsm-halo{display:none}.rsm-wm{display:none}" +
    ".rsm-sym{animation:rsm-rfade .16s linear both}" +
    ".rsm[data-step=brand] .rsm-hero{animation:rsm-rhide .12s linear both}" +
    ".rsm[data-step=brand] .rsm-full{display:block;animation:rsm-rfade .18s linear .11s both}" +
    ".rsm-check{animation:rsm-rfade .15s linear both}.rsm-check svg{animation:none;stroke-dashoffset:0}" +
    ".rsm-msg{animation:rsm-rfade .15s linear both}" +
    ".rsm[data-scene=launch][data-phase=exit] .rsm-stage,.rsm[data-scene=complete][data-phase=exit] .rsm-stage{animation:none}" +
    ".rsm[data-phase=exit],.rsm[data-scene=launch][data-phase=exit]{animation:rsm-fs 0s linear 3s forwards,rsm-exit .15s linear forwards}}" +
    "@keyframes rsm-rhide{to{opacity:0}}" +
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
    } catch {
      return false;
    }
  }

  function icon(id) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + ICONS[id] + '"/></svg>';
  }

  function markup(scene, items) {
    if (scene === "launch") {
      // Sem texto, sem ícones: só o símbolo oficial e o lockup oficial (o nome sai do próprio PNG).
      var lockup = 'src="' + LOCKUP_SRC + '" alt="" decoding="async" data-lockup';
      return (
        '<div class="rsm-stage"><div class="rsm-brand">' +
        '<div class="rsm-wm"><div class="rsm-wc"><div class="rsm-wt"><img ' + lockup + "></div></div></div>" +
        '<img class="rsm-full" ' + lockup + ">" +
        '<div class="rsm-hero"><img class="rsm-sym" src="' + SYMBOL_SRC + '" alt="" decoding="async"></div>' +
        "</div></div>"
      );
    }
    var n = items.length;
    var h = '<div class="rsm-halo"></div><div class="rsm-stage"><i class="rsm-dot"></i>';
    for (var i = 0; i < n; i++) {
      h += '<span class="rsm-sat" style="--i:' + i + ";--n:" + n + '">' + icon(items[i]) + "</span>";
    }
    h +=
      '<span class="rsm-check"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg></span>' +
      '<p class="rsm-msg">Tudo pronto</p>';
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
    var items = scene === "launch" ? null : ITEMS[ITEMS[variant] ? variant : "products"];

    var el = null;
    var lockup = null;
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
      if (scene === "launch") el.setAttribute("data-step", "symbol");
      if (reduced) el.setAttribute("data-reduced", "1");
      el.setAttribute("aria-hidden", "true");
      el.innerHTML = markup(scene, items);
      (d.body || d.documentElement).appendChild(el);
    } catch {
      // Falha aberta: se não conseguimos desenhar, o app simplesmente aparece normal.
      if (el && el.remove) el.remove();
      return Promise.resolve({ reason: "error", ms: 0 });
    }

    if (scene === "launch") {
      try {
        lockup = el.querySelector ? el.querySelector("img[data-lockup]") : null;
        // Decodifica o lockup fora da thread principal antes do reveal (asset local/pré-cacheado).
        if (lockup && lockup.decode) lockup.decode().then(null, function () {});
      } catch {
        lockup = null;
      }
    }

    function clearTimers() {
      while (timers.length) w.clearTimeout(timers.pop());
    }

    function finish(reason) {
      if (finished) return;
      finished = true;
      clearTimers();
      if (lockup) lockup.onload = null;
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

    // Símbolo → lockup. Só revela o nome com o PNG do lockup já carregado; se ele não chegou, o
    // símbolo segue sozinho (nunca um nome "pela metade") e só revela depois se ainda couber
    // inteiro antes do mínimo. Isto é só apresentação: não mexe em MIN/MAX nem em ready.
    function brand() {
      if (exiting || finished) return;
      if (!lockup || (lockup.complete && lockup.naturalWidth > 0)) {
        el.setAttribute("data-step", "brand");
        return;
      }
      lockup.onload = function () {
        if (!exiting && !finished && nowMs() - t0 + t.reveal <= t.min) el.setAttribute("data-step", "brand");
      };
    }

    timers.push(w.setTimeout(evaluate, t.min));
    timers.push(w.setTimeout(evaluate, t.max));
    timers.push(w.setTimeout(function () {
      if (!exiting && !finished) el.setAttribute("data-phase", "hold");
    }, t.target));
    if (scene === "launch") timers.push(w.setTimeout(brand, t.brand));

    active = { el: el, promise: promise, evaluate: evaluate, cancel: function () { finish("cancel"); } };
    return promise;
  }

  function markCold() {
    try {
      w.sessionStorage.setItem("rs:launch-motion:v2", "1");
    } catch { /* sem sessionStorage: tocamos mesmo assim, uma vez por documento */ }
  }

  function alreadyPlayedThisSession() {
    try {
      return w.sessionStorage.getItem("rs:launch-motion:v2") === "1";
    } catch {
      return false;
    }
  }

  function isAppShell() {
    try {
      var cap = w.Capacitor;
      if (cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform()) return true;
      if (/; wv\)/.test((w.navigator && w.navigator.userAgent) || "")) return true;
      return !!(w.matchMedia && w.matchMedia("(display-mode: standalone)").matches);
    } catch {
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
    version: 2,
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
