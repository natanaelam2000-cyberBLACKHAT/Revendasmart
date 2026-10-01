# REVENDASMART — Motion System (MOTION-SYSTEM-01)

Linguagem visual única — **REVENDASMART FLOW** — para três experiências:

| | Experiência | Onde roda | Status |
|---|---|---|---|
| A | **Play Store promo** — vídeo externo de 30–45 s | YouTube / Play Console | Blueprint (§9). Nada gravado nesta fase. |
| B | **App launch motion** — animação curta no cold start | App (Android Capacitor, PWA/TWA instalado) | **Implementado** |
| C | **Onboarding completion** — "Tudo pronto" antes do dashboard | App (`/onboarding`) | **Infra implementada**; variantes de modo ainda provisórias |

Não existe editor de vídeo no app. A e a versão final de B/C em Rive/After Effects são produção posterior (§8, §9, §10).

---

## 1. Princípio obrigatório: MOTION ≠ BOOTSTRAP AUTHORITY

A motion **mascara** o tempo de carregamento; nunca o **decide**.

| A motion PODE | A motion NÃO PODE |
|---|---|
| Cobrir a tela enquanto o app real carrega por baixo | Decidir se auth está pronto |
| Receber o sinal "app pronto" que o React já derivou do estado existente | Inventar user settings, `businessMode`, plano ou rota |
| Sair antes do teto se o app ficou pronto | Conceder rota/plano, alterar tenant, substituir fail-closed |
| Sair no teto mesmo sem app pronto | Segurar o app indefinidamente / entrar em loop |

Garantias de código (todas cobertas por `script/motion-system-tests.ts`):

- o motor **não faz rede** e não toca auth, settings, plano, tenant nem `localStorage` (só um marcador em `sessionStorage`);
- o app é **montado por baixo em paralelo**; o overlay só cobre — não há "gate" que impeça o render;
- teto absoluto (`MAX`) **e** failsafe CSS de 3 s que esconde o overlay mesmo se o JS travar;
- terminar a motion **não** marca o app como pronto.

## 2. Arquitetura (B + C)

```
NATIVE SPLASH (androidx, símbolo oficial)
        ↓
LAUNCH MOTION  ── overlay fixo, aria-hidden, por cima de tudo ─────────────┐
                                                                           │ (só cobre)
em paralelo, SEM mudanças:                                                 │
  PrivateRoutes (auth) · UserSettingsProvider · PlanProvider · rotas       │
        ↓ estado já existente                                              │
  LaunchReady  (observa settings.loading e plan.loading — nada novo)       │
        ↓ reportAppReady()                                                 │
  rsMotion.ready()  ──► libera a SAÍDA (nunca a prontidão) ────────────────┘

ENTER_APP = MOTION_MINIMUM_COMPLETE (≥ MIN) + APP_READY
            ou  teto MAX  → loader/erro real do app (já seguro) assume
```

### Arquivos

| Arquivo | Papel |
|---|---|
| `client/index.html` | Bootstrap inline (~1 kB, com comentário). **Só em app instalado** (Capacitor, UA `; wv)` ou `display-mode: standalone`) ou com `?launch-motion=1`, e nunca em `/u/*` e `/sorteio/*`: cria o stub `window.rsMotion {ready, play}` e carrega o motor com `document.write` **síncrono**. Síncrono de propósito: um `<script async>` não garante a ordem e o bundle React pode executar antes, fazendo a motion aparecer depois do primeiro frame do app. Falha aberta (`onerror` remove o stub). |
| `client/public/motion/revendasmart-motion.v1.js` | Motor: CSS + SVG + controlador de tempo. Sem dependências, sem rede. |
| `client/src/lib/motion-bridge.ts` | Ponte tipada: `reportAppReady()`, `playOnboardingCompletionMotion(mode)`. No-op se o motor não carregou. |
| `client/src/components/LaunchReady.tsx` | Observa os contextos **já existentes** e chama `reportAppReady()`. Montado uma vez em `PrivateRouter`, dentro de `UserSettingsProvider` > `PlanProvider`. |
| `client/src/pages/onboarding.tsx` | `handleComplete`: após o save confirmado, `playOnboardingCompletionMotion("products")` — sem `await`. |
| `script/motion-system-tests.ts` | Executa o motor real num `vm` com relógio/DOM falsos + guardas de código-fonte. `npm run test:motion`. |

### API do motor (`window.rsMotion`)

```ts
play(scene: "launch" | "complete", variant?: "products" | "services" | "both"): Promise<{ reason; ms }>
ready(): void      // latch idempotente; só libera a saída
cancel(): void     // remove overlay e limpa todos os timers
timing             // { launch, complete, exitMs } — somente leitura
```

`play` é *single-flight* (nunca empilha overlays), **nunca rejeita** e resolve em no máximo `MAX + exitMs`. `reason`: `ready` · `max` · `complete` · `cancel` · `error`.

### Quatro nomes conceituais → implementação real

| Conceito | Onde está |
|---|---|
| `LaunchExperience` | bootstrap do `index.html` + `autoLaunch()` do motor |
| `LaunchMotion` | cena `launch` do motor |
| `OnboardingCompletionMotion` | cena `complete` + `playOnboardingCompletionMotion` |
| `MotionGate` | `LaunchReady` (sinal) + regra `ENTER_APP` no motor (saída) |

> **Por que não são componentes React?** O orçamento de JS total tinha **0,26 kB de folga** (2289,74 de 2290 kB). Qualquer componente novo no bundle estouraria `performance:bundle-check`, que não pode ser alterado. Fora do bundle, a motion também começa **antes** do React montar — exatamente o intervalo morto do cold start. Ver §7.

## 3. Timing

| Constante | Launch | Conclusão | Papel |
|---|---|---|---|
| `MIN` | **900 ms** | 1500 ms | Primeira saída possível: o símbolo já se formou. Nunca sai antes. |
| `TARGET` | **1800 ms** | 1500 ms | Fim natural da sequência. Depois disso o último quadro fica parado (`hold`). |
| `MAX` | **2500 ms** | 1500 ms | Teto. Sai mesmo sem app pronto; o loader/erro real assume. |
| saída | 260 ms | 260 ms | Fade + leve zoom. |
| reduced motion | 300 / 300 / 1200 | 450 / 450 / 450 | Só fade (§5). |

Conclusão do onboarding tem duração fixa e **não** espera app pronto — é só apresentação.

| Cenário | Comportamento |
|---|---|
| App pronto cedo (<900 ms) | Espera `MIN`, sai em 900 ms (≈1,16 s total). |
| App pronto entre 900 ms e 1800 ms | Sai assim que fica pronto (termina a sequência naturalmente). |
| App pronto entre 1800 ms e 2500 ms | Último quadro parado até ficar pronto, então sai. |
| App não pronto em 2500 ms | Sai em `MAX`. O app real (skeleton/erro/login) já está visível por baixo. |

## 4. Cold start vs resume

Cold start = o motor rodando num **documento novo** (processo/WebView novo). Voltar do background, trocar aba, navegar e abrir modal **não recarregam o documento**, então a motion não repete — e o motor não registra nenhum listener de lifecycle (teste garante).

- Só toca em app instalado: `Capacitor.isNativePlatform()`, UA `; wv)`, ou `display-mode: standalone` (PWA/TWA). **Navegador comum não vê motion nem baixa o motor** (0 requisições; os e2e Playwright seguem intocados). Consequência: a motion de conclusão (C) também é no-op fora do app instalado/`?launch-motion=1`.
- Marcador `sessionStorage["rs:launch-motion:v1"]`: um reload no mesmo WebView/aba (ex.: o `location.reload()` de troca de versão em `main.tsx`) não repete. `sessionStorage` bloqueado → toca uma vez por documento.
- Nunca em rotas públicas (`/login`, `/signup`, `/account-deletion`, `/u/*`, `/sorteio/*`) — lista espelhada de `isPublicPath` em `App.tsx`, com teste de deriva.
- Limite conhecido: se o Android matar só o renderer do WebView e recarregar a página na volta, isso conta como documento novo. Nenhum mecanismo confiável distingue isso hoje; solução mínima/local escolhida de propósito.

## 5. Acessibilidade

- `prefers-reduced-motion: reduce`: sem pontos/satélites/trajetória/zoom; só fade do símbolo (150 ms), tempos 300/1200 ms. Sem perda funcional.
- Overlay `aria-hidden="true"`: leitores de tela seguem no app real por baixo.
- Nenhuma animação `infinite`.

## 6. Matriz de falhas

A motion **nunca** esconde erro permanente: o app real (e o erro dele) fica por baixo e aparece em `MAX` no pior caso. "Pronto" = `!settings.loading && !plan.loading`; ambos os hooks fazem `loading=false` no `finally`, então **erro também libera a saída**.

| Cenário | O que acontece |
|---|---|
| Boot rápido | Sai em `MIN` (≈1,16 s). |
| Auth lento | Hold até pronto ou `MAX`; depois skeleton existente. |
| Settings lento | Idem. |
| Offline com cache válido | Settings/plano resolvem como hoje; ready; sai em `MIN`. |
| Offline sem cache | Fetch falha → `loading=false` com erro → ready → tela de erro/estado real do app. |
| 401/403 | Idem; fluxo de login/erro existente. |
| 5xx | Idem; erro existente visível após a saída. |
| `auth == null` | Settings/plano `loading=false` → ready → `PrivateRoutes` redireciona para `/login` (por baixo; overlay cobre o redirect). |
| Autenticado | Ready quando settings **e** plano resolvem. |
| A→B (troca de conta) | Motion só roda no cold start; troca em runtime não a dispara. |
| Onboarding incompleto | Inalterado: `dashboard` mostra a faixa/redireciona como hoje. |
| Onboarding recém-concluído | Save confirmado → motion de conclusão (fire-and-forget) → `setLocation` imediato. |
| Motor não carregou / DOM falhou | Falha aberta: o app aparece normal. |
| JS travado | Failsafe CSS esconde o overlay em 3 s. |

Não há chamadas duplicadas: **0** listeners de auth, **0** fetches de settings, **0** fetches de plano adicionados (testes contam `onAuthStateChanged(` por arquivo e proíbem rede/auth no motor e na ponte).

## 7. Orçamento de bundle (e armadilhas)

Medido contra o HEAD limpo:

| | Antes | Depois | Delta |
|---|---|---|---|
| Total JS | 2289,74 kB (2.344.708 B) | 2289,99 kB (2.344.964 B) | **+256 B** — orçamento 2290 kB |
| Entry JS | 33,56 kB | 33,56 kB | 0 (byte a byte) |
| CSS principal | 177,27 kB | 177,27 kB | 0 (byte a byte) — orçamento 178 kB |

O delta de 256 B é só `LaunchReady` + ponte + 1 linha no onboarding. **A folga restante é 0,01 kB**: o próximo código novo no bundle precisa de re-baseline explícito do dono.

> `CLAUDE.md` cita "2265 kB" mas o `check-bundle-budgets.mjs` real aplica 2290 kB (recalibrado em tickets anteriores). Nada foi alterado em nenhum dos dois.

Armadilhas descobertas:

1. **Tailwind v4 varre `client/**` inclusive `client/public/`.** Tokens como `ease-in`/`ease-out` no motor geraram 2 utilitários e +228 B no CSS global. O motor usa `cubic-bezier(...)` e há teste proibindo `ease-*`. Evite também outros tokens que sejam nomes de utilitário em strings do motor.
2. **O service worker serve scripts same-origin em cache-first** (`client/public/sw.js`). O nome versionado (`…v1.js`) é o mecanismo de invalidação: ao alterar o motor, publique `…v2.js` e atualize o bootstrap — nunca edite o `v1` em produção. (Mesma convenção dos ícones `-v7`.)
3. Fora do bundle ≠ grátis: o motor tem 13,5 kB (5,3 kB gzip), carregado **só em app instalado/QA forçado** (disco local no app; cacheado pelo SW em PWA/TWA). Visitantes web comuns e catálogo/sorteio públicos não baixam nada. Como o carregamento é síncrono, o custo no app é uma leitura local pequena antes do parse seguir. O PNG do símbolo (`logo-revenda-smart-symbol-official.png`, 618 kB) já era pré-cacheado pelo SW; para o passe visual, gerar uma versão ~192–256 px otimizada é um ganho barato.

## 8. QA e integração futura

### QA manual

- `?launch-motion=1` força a motion de launch em qualquer navegador (ignora marcador e ambiente); `?launch-motion=0` desliga.
- DevTools → Rendering → *Emulate prefers-reduced-motion* para a versão reduzida.
- Congelar quadros: `document.getAnimations().forEach(a => { a.pause(); a.currentTime = 700 })`.
- Conclusão do onboarding: no console, `rsMotion.play("complete","products")`.

### Verificação executada

- `npm run test:motion` — executa o motor **real** num `vm` (relógio/DOM falsos) + guardas de código-fonte. Mutação: 7 defeitos injetados no motor (ignorar `MIN`, remover o teto, motion "conceder" prontidão, sem `aria-hidden`, launch em rota pública, sem single-flight, `finish` sem limpar timers) — todos reprovam a suíte.
- Chromium real sobre o build de produção: app nativo simulado (overlay, saída em ≈`MIN`+saída), web comum (0 requisições do motor), `/u/*` (nada), `/login` nativo (motor carregado, sem launch), reduced-motion (≈0,6 s), `?launch-motion=1`.
- Teto ponta a ponta: com o `ready()` do React neutralizado, o app real monta em paralelo por baixo e a motion segue `run → hold (+1800 ms) → exit (+2500 ms) → removida (+2761 ms)`.
- Quadros congelados (`getAnimations()`): ponto → 5 elementos → convergência → símbolo oficial (sem "caixa" branca: `clip-path` circular + `multiply`) → cena "Tudo pronto".

### Rive / Lottie (arquitetura pronta, nada instalado)

Ponto único de troca: `markup()` + `CSS` do motor (cena = DOM + CSS + tempo). Para migrar para Rive:

1. Produzir `revendasmart-flow.riv` com **os mesmos marcos**: ponto → 5 elementos → convergência → símbolo (≤ 900 ms para o símbolo formado, sequência ≤ 1800 ms) e uma state machine com `exit`.
2. Novo motor `revendasmart-motion.v2.js` carrega o runtime Rive **sob demanda e só no app instalado**, mantendo `play/ready/cancel/timing` idênticos e a regra de saída (`MIN/TARGET/MAX`).
3. **Fallback obrigatório**: se o runtime/arquivo falhar ou passar de um orçamento, cair na cena CSS atual (a v1 é o fallback).
4. Revisar licença do arquivo `.riv`/Lottie (§10) e orçamento (o runtime Rive WASM é pesado — medir antes de adotar; Lottie-web idem).
5. `prefers-reduced-motion` continua obrigatório (primeiro quadro estático + fade).

### Modo de negócio (C)

`playOnboardingCompletionMotion(mode)` aceita `"products" | "services" | "both"` e só muda os ícones. **Hoje o app não tem `businessMode`** (só nichos de produto), então o onboarding passa `"products"` fixo. Quando existir um `businessMode` real, ligar apenas a *apresentação* a ele — nunca o contrário. `"both"` é uma combinação provisória.

### Splash nativo → motion (pendente, fora do escopo)

O splash nativo (androidx, `splashBackground #FBF9FF`, badge roxo/dourado) some no primeiro frame e o WebView fica em branco até o HTML pintar. A motion usa o mesmo fundo e o mesmo símbolo para continuidade, mas o intervalo em branco existe hoje e continua existindo. Para eliminá-lo: `backgroundColor` do WebView no `capacitor.config.ts` e/ou `@capacitor/splash-screen` com `launchAutoHide: false` escondido no primeiro frame da motion — ambos exigem `cap sync`/novo APK e (o segundo) dependência nova; ficam para o passe nativo.

### Tema escuro

O overlay é sempre claro (`#FBF9FF`) para casar com o splash nativo, que não tem variante noturna. Se o splash ganhar `values-night`, espelhar aqui.

## 9. Blueprint do vídeo Play Store (A)

**Formato.** O Play Console aceita um link do YouTube para o vídeo promocional (confirmar os requisitos vigentes antes de publicar — hoje: público ou não listado, sem restrição de idade, sem anúncios/monetização). Master horizontal 16:9, 1920×1080, 30 fps, 30–45 s; exportar também uma versão vertical 9:16 para Stories/Shorts. Texto na tela em pt-BR, legível sem áudio; áudio é bônus (muita gente assiste mudo).

**Regra de integridade.** O vídeo só pode mostrar funcionalidades **presentes na build publicada** (política de metadados da Play Store). Telas capturadas de uma **conta demo com dados fictícios** — nunca clientes, telefones, fotos ou vendas reais (LGPD). A conta de revisão em `docs/PLAY_REVIEW_ACCESS.md` pode servir de base.

| Tempo | Cena | Tela real a capturar (rota) | Origem do asset | Observações |
|---|---|---|---|---|
| 0–3 s | **Brand hook** | — | **Original**: motion REVENDASMART FLOW (§2) exportada do Rive/AE; símbolo oficial | Mesma linguagem do launch. Frase curta: "Sua revenda, do seu jeito." |
| 3–8 s | **Dashboard / organização** | Dashboard (`/`) com dados demo vivos | Captura original + **Envato**: mockup de telefone e transição leve | Mostrar números/indicadores reais do demo. |
| 8–14 s | **Produtos** | Lista (`/products`) → cadastro (`/add-product`) com foto | Captura original | Foto de produto real de demo; destacar estoque/preço. |
| 14–19 s | **Vendas** | Venda rápida (`/sell`) → confirmação | Captura original; tipografia cinética (**Envato**) para "Vendeu. Registrou." | Mostrar fluxo curto, sem pagamento real. |
| 19–24 s | **Clientes / pedidos** | `/clients`, `/clients/:id`, `/orders` | Captura original | Nomes fictícios. |
| 24–29 s | **Catálogo** | Catálogo (`/catalog`) + catálogo público (`/u/<loja-demo>`) no celular | Captura original + mockup (**Envato**) | Mostrar o link/compartilhamento do catálogo. |
| 29–34 s | **Serviços / agenda** | **Depende de a funcionalidade estar publicada.** Hoje o app tem Cobranças e Agenda de cobranças (`/billings`, `/billing-calendar`) — não há "Serviços" no app. | Captura original | Se Serviços não estiver na build, mostrar só o que existe (agenda de cobranças) e **não** prometer serviços. |
| 34–39 s | **Ads Pro / sorteio / premium** | Marketing (`/marketing`: criativos), Sorteios (`/sorteios`), planos (`/subscribe`) | Captura original + Rive/AE para destaque de selo Premium | Só recursos presentes e liberados na build; indicar o que é Premium com clareza. |
| 39–45 s | **Brand close + CTA** | — | **Original**: símbolo + "Revenda Smart" + "Baixe no Google Play" | Reaproveitar a saída da motion de launch; end card estático ≥ 2 s. |

### O que é original / Envato / Rive-AE

- **Sempre original:** capturas de tela do app, símbolo e nome oficiais, a motion REVENDASMART FLOW, textos/CTA, voz (se houver).
- **Pode vir do Envato (após revisão de licença, §10):** mockup de telefone, transições mínimas, tipografia cinética (re-skin com a fonte/cores da marca), trilha e UI sound effects, base de logo reveal.
- **Produzir em Rive / After Effects:** o hook (ponto → elementos → símbolo), a saída de marca, destaques de UI (anéis, setas, selo Premium) — mesmos marcos de tempo da motion do app, para o vídeo e o app parecerem a mesma peça.

### Checklist de captura

- [ ] Conta demo com dados fictícios consistentes (loja, 12+ produtos com foto, 6+ clientes, vendas dos últimos 7 dias).
- [ ] Build exata da versão publicada; tema claro; status bar limpa (hora/bateria padronizadas).
- [ ] 1080×2400 (ou resolução nativa do aparelho) em 60 fps, sem teclado/notificações; gravar cada fluxo separadamente.
- [ ] Nada de e-mail, telefone, CPF, endereço ou foto de pessoa real.
- [ ] Safe zone de 5% nas bordas; textos ≥ 48 px no 1080p.

## 10. Plano de assets Envato

**Não baixar nada automaticamente. Não introduzir asset sem licença e proveniência conhecidas.**

Categorias a pesquisar (Envato Elements / Market):

- SaaS app promo · mobile app presentation · UI showcase
- clean technology opener · modern logo reveal · dashboard promo
- kinetic typography · phone mockup · minimal transitions
- UI sound effects · trilhas curtas (corporate/tech, sem vocal)

Critérios de escolha: estética **premium, limpa, tecnológica** (paleta roxo `#4C16AD` + dourado `#D4AF37` + fundo `#FBF9FF`); sem confete, sem partículas em excesso, sem cara de template genérico; totalmente editável (cores/fontes/tempo); plugins/fontes inclusos ou livres.

Antes de qualquer uso, registrar por asset (planilha ou `docs/motion-assets-register.md`):

| Campo | Exemplo |
|---|---|
| Nome / link do item | — |
| Autor | — |
| Licença (Elements assinatura ou Market por-projeto) | Cobre uso comercial em vídeo promocional de app publicado em loja? |
| Escopo/limites | Nº de projetos, usuários, exclusividade |
| Data da compra/download e conta dona da licença | — |
| Onde foi usado | Vídeo Play Store / app / ambos |
| Modificações feitas | Re-skin, corte, cor |

Regras: licença de **assinatura** exige que a conta fique ativa conforme a política Envato para projetos registrados — registrar o projeto no Elements ao baixar; música e SFX têm licença própria (checar uso em YouTube/Content ID); **nenhum asset de terceiros entra no app** (só no vídeo) sem passar pelo mesmo registro e por revisão de peso/licença; nenhum asset entra no repositório sem proveniência registrada.

## 11. Próximos passos sugeridos

1. **Passe visual** (designer/motion): refinar ícones, easing e a cena de conclusão; otimizar o PNG do símbolo (§7).
2. Passe nativo do splash → motion (§8).
3. Produção do vídeo (§9) seguindo o checklist de captura.
4. Decisão do dono sobre re-baseline do orçamento de JS caso se queira migrar o motor para componentes React/Rive (§2, §8).
