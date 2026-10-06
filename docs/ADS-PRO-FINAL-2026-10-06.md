# ADS PRO — Entrega final (2026-10-06)

Handoff da jornada "ADS PRO FINAL RECOVERY / IMPLEMENTATION DAY". Tudo abaixo foi **executado de verdade** nesta
branch; o que não pôde ser executado está marcado como limitação — nenhum PASS foi escrito sem execução.

## 1. Onde está o código

| Item | Valor |
| --- | --- |
| Branch de trabalho | `claude/ads-pro-final-2026-10-06` (origin) |
| Base canônica | `10f0f4ef4785c398dae02da31c2e1699990a8285` (`recovery/revendasmart-canonical-2026-10-05`, intacta) |
| `main` / `release/revendasmart-rc1-integrated` | não usadas, nenhum merge, nenhum reset |
| Branch de assets (309 fundos) | **ainda não existe no origin** — ver §5 |

Commits desta jornada (em ordem):

1. `e7fcc1c` feat(ads-pro): audit background library and build production manifest
2. `65929cc` feat(ads-pro): integrate creative profile into deterministic composition
3. `e0a2a57` feat(ads-pro): finalize background catalog, matcher ranking and studio state
4. `d6947c9` feat(ads-pro): complete editing, export and share flow
5. `d8f866c` test(ads-pro): harden end-to-end generation workflow
6. commits seguintes (E2E do perfil/quiz, ajustes de layout 320px e este documento) — ver `git log 10f0f4e..HEAD`

## 2. O que o vendedor tem agora (fluxo conectado)

`PRODUTO → FOTO → MELHORAR FOTO → REMOVER FUNDO (opcional) → ESTILO/OBJETIVO → 3+ OPÇÕES (cada uma já com fundo) →
COMPARAR → TROCAR FUNDO → EDITAR → SALVAR → EXPORTAR PNG → COMPARTILHAR → REABRIR e continuar editando`

Na aba **Anúncio Pro** (continua restrita ao admin, como já era) o estúdio é o fluxo principal; as ferramentas
antigas (conceitos, recorte salvo no produto, Composer V2, fundo com IA) ficam em "Ferramentas avançadas e
experimentais". A lista falsa "Em desenvolvimento" foi removida.

| Etapa | O que faz de verdade | Onde |
| --- | --- | --- |
| Foto | carrega a foto real do produto; **nunca a altera** (ajustes vivem numa cópia em canvas) | `ads-pro-studio-assets.ts` |
| Melhorar foto | análise local (histograma/nitidez) → ajuste automático conservador + sliders (brilho, contraste, cor, nitidez) + "Ver foto original"; foto já boa devolve "nada precisou mudar" | `shared/ads-pro/ad-photo-adjust.ts` |
| Remover fundo | **local e grátis** (flood-fill a partir das bordas, `product-cutout-pipeline`) com limiares que **seguem a cor real do fundo** (branco, cinza ou bege de estúdio; fundo escuro/médio continua falhando de forma honesta) e recorte **aparado** nas margens para o produto aparecer grande; falhou → segue com a foto original com mensagem honesta | `use-studio-assets.ts`, `ad-cutout-options.ts` |
| Estilo | quiz de estilo (perfil) → estilos que **lideram** as opções; dá para escolher um estilo só para este anúncio; objetivo (Destaque/Promoção/Novidade/Últimas unidades/…); intensidade; formato 4:5 ou 1:1 | `ad-style-direction.ts` |
| Opções | 3 versões **realmente diferentes** (papéis "Fiel ao seu estilo" / "Mais destaque" / "Mais sutil": estilo, composição, hierarquia, espaçamento, botão, estilo do preço, decoração e **fundo** mudam); "Outras opções" gira as escolhas de forma determinística | `ad-variations.ts` |
| Comparar | diálogo lado a lado com as opções grandes e o porquê de cada uma (estilo, composição, fundo) | `StudioOptionsStep.tsx` |
| Fundo | grade ordenada pelo matcher (só ativos do **manifest aprovado**); trocar fundo é instantâneo e grátis | `StudioBackgroundStep.tsx`, `ad-variations.ts` |
| Editar | título, subtítulo, chamada, botão (com mostrar/esconder), composição, estilo do preço/botão, decoração, desfazer/refazer. **Preço nunca é digitado**: vem do cadastro (só dá para esconder) | `StudioEditStep.tsx` |
| Salvar | mesmo histórico de anúncios (`users/{uid}/marketingHistory`), `entryId` estável, upload em caminho fixo → salvar de novo **atualiza**, nunca duplica; guarda o documento editável (`proDocument`) | `ads-pro-studio-persistence.ts` |
| Exportar | PNG no tamanho exato do formato (4:5 = 1080×1350, 1:1 = 1080×1080), mesma função de desenho da prévia; o estúdio recusa o arquivo se a dimensão divergir | `ads-pro-studio-render.ts` |
| Compartilhar | reaproveita `marketing-share.ts`: Capacitor nativo quando existe, Web Share com arquivo na web, senão baixa o PNG **e avisa que baixou**; cancelar o seletor não é erro | `ads-pro-studio-export.ts` |
| Reabrir | lista "Anúncios salvos para continuar editando"; reabre com texto/fundo/foto/composição como estavam | `StudioSaveStep.tsx` |

Mobile first: bloco fixo (prévia + 6 abas) logo abaixo do cabeçalho, `scroll-padding` para o foco não ficar atrás
dele, alvos ≥ 44 px de altura, diálogos com safe-area, sem rolagem lateral (360 e 320 px), desktop em duas colunas.

## 3. Arquitetura final (resumo)

```
shared/ads-pro/                      (puro, testável em Node)
  ad-product-facts.ts   fatos REAIS do produto (preço nulo = sem preço; "Sem marca" não vira texto)
  ad-style-direction.ts perfil + categoria + objetivo → direção de arte (estilo, hierarquia, botão, preço…)
  ad-variations.ts      N opções diferentes + rankAdsProBackgroundsForFacts (matcher/manifest)
  ad-document.ts        AdsProAdDocumentV1: decisões (nunca pixels); (de)serialização estrita (≤ 3600 chars)
  ad-layout.ts          geometria única (área segura, recorte central do 4:5, texto sem vazar, contraste WCAG)
  ad-studio-state.ts    reducer: escolher opção, editar, desfazer, "novas opções", projeto reaberto
  ad-quota-policy.ts    a regra de cota como código verificável
  background-catalog.ts fundos gerados + estáticos aprovados + manifest (SÓ o chunk do estúdio importa)
  background-audit.ts / static-background-entry.ts / approved-static-backgrounds.ts   pipeline dos 309
client/src/lib/ads-pro-studio-*.ts   render canvas, imagens, persistência, export/compartilhar, catálogo
client/src/components/marketing/ads-pro-studio/   UI (lazy chunk)
```

Decisões que importam:

- **UM renderer** (`renderAdsProAd`) para prévia, miniaturas e exportação; o layout é calculado com a medição do
  canvas real (fontes do sistema: sem webfont, medição síncrona e igual entre prévia e PNG).
- **Legibilidade**: tinta escolhida por contraste WCAG sobre a luminância *medida* do fundo; fundos movimentados
  recebem scrim. (O compositor antigo desenhava texto escuro sobre fundos quase pretos.)
- **Catálogo do estúdio separado da biblioteca da rota Marketing**: a lista aprovada pode ter centenas de
  entradas; importá-la na rota estouraria o budget de bundle. A rota continua com os 12 fundos gerados.
- **Perfil → geração**: o cartão do quiz (`AdsProProfileCard`) vive dentro do estúdio; `preferredStyles` entra em
  `generateAdsProVariations`; sem perfil o estilo vem da categoria e a interface diz isso.

## 4. Cota (regra existente, preservada e documentada)

Regra comercial que já existia (PLAN-IMPL-05, `server/ads-pro-preparation-quota.ts`,
`PLAN_CONFIG[plan].limits.proAdPreparationsMonthly`): **só a "preparação profissional" de produto (recorte via
PhotoRoom, no cadastro do produto) consome a cota mensal** — Pro: 3/mês, Premium: 100/mês — com reserva atômica por
produto/mês, `generationRequestId` idempotente e devolução da vaga em falha. **Nada do estúdio consome cota**:
prévia, trocar fundo/estilo/opção, "outras opções", editar, melhorar foto, recorte local, salvar, exportar,
compartilhar e reabrir são 100% locais (provado por guarda estática + E2E sem nenhuma chamada paga).

Ambiguidade registrada (nenhuma regra nova foi inventada): não existe regra comercial para "gerar anúncio" — a
unidade vendida é o *produto preparado*, reutilizável em quantos anúncios o dono quiser. O estúdio segue isso.
Se o produto quiser limitar/medir anúncios do estúdio no futuro, a ação precisa ser declarada em
`ad-quota-policy.ts` antes de existir.

Retry idempotente: o salvar do estúdio usa o mesmo `entryId` e o mesmo caminho de upload; três salvamentos =
um registro (unitário `FL5` + E2E lendo o Firestore). A idempotência do consumo de cota no servidor está em
`script/plan-impl-05-ads-pro-preparation-quota-tests.ts`.

## 5. Biblioteca de fundos (309) — situação honesta

`BACKGROUND_LIBRARY_SOURCE=INCOMPLETE`: a branch `origin/recovery/ads-pro-assets-2026-10-06` **não foi publicada**
(`git ls-remote origin 'refs/heads/recovery/*'` só lista a canônica; checado várias vezes, inclusive no fim).
Não inventei assets. O que existe e foi provado:

| Contagem | Valor |
| --- | --- |
| TRACKED_BACKGROUND_ASSETS (arquivos de fundo rastreados no repo) | 0 |
| MANIFEST_BACKGROUND_ENTRIES | 12 (fundos gerados em código) |
| VALID_BACKGROUND_ENTRIES | 12 |
| MISSING_BACKGROUND_FILES | 0 |
| DUPLICATES | 0 |

Pipeline pronto para os 309 (`shared/ads-pro/background-audit.ts` + `script/ads-pro-background-audit.ts`, 17 testes
incluindo conjunto sintético): conta fonte, duplicatas exatas (SHA-256) e visuais (dHash/aHash), corrompidos,
baixa resolução/proporção, mede luminância e "movimento" do texto, classifica em doces, alimentos, eletrônicos,
cosméticos/perfumes, roupas, acessórios, papelaria, casa e decoração, utilidades e geral/outros, publica WebP +
miniaturas em `client/public/ads-pro/backgrounds/` e gera o manifest aprovado — o **único** insumo do matcher; o
acervo bruto (`source-assets/`) nunca é lido em runtime e nunca é apagado.

Quando a branch existir (comandos exatos):

```bash
git fetch origin --prune
git rev-parse origin/recovery/ads-pro-assets-2026-10-06 origin/recovery/ads-pro-assets-2026-10-06^   # o 2º precisa ser 10f0f4ef…
git checkout claude/ads-pro-final-2026-10-06
git merge --no-ff origin/recovery/ads-pro-assets-2026-10-06          # merge, nunca rebase/force-push
npx tsx script/ads-pro-background-audit.ts                           # dry-run: SOURCE_BACKGROUND_COUNT, EXACT_DUPLICATES, VISUAL_DUPLICATES, CORRUPTED_FILES, VALID_BACKGROUNDS, REJECTED_BACKGROUNDS, por balde
npx tsx script/ads-pro-background-audit.ts --write                   # publica WebP + approved-static-backgrounds.ts + docs/ads-pro/background-audit/
npm run test:ads-pro:final && npm run check && npm run build && npm run performance:bundle-check
```

Curadoria manual opcional: `source-assets/ads-pro-backgrounds/curation.json`. Os 309 WebP vão para `client/public`
(não entram no JS), mas aumentam o APK/AAB — decidir antes do próximo release Android.

Cobertura de estilo hoje: os 12 fundos gerados cobrem `luxury/editorial/minimal/modern` (3 cada); **não há fundo
específico para `sensory`** (o matcher cai no vizinho). Também há pouca variedade para alimentos/casa. Os fundos
fotográficos aprovados resolvem isso — não foi inventado nada para tapar o buraco.

## 6. Testes executados e resultado real

| Verificação | Resultado |
| --- | --- |
| `npm run check` (tsc) | PASS |
| `npx eslint --max-warnings=0` em todos os arquivos tocados/novos | PASS (`npm run lint` lista 1 warning **pré-existente** em `settings.tsx`) |
| `npm run build` | PASS |
| `git diff --check` | PASS |
| Testes alvo exigidos (creative-intelligence, creative-director, concepts-ui, pro-ad-generation-ui, `ads-pro-04:geometry`, pro13, `pro14c`, `pro14g`, `pro14i`, `marketing-pro:bg-library`, `bg-orchestration`, `history`) | PASS (12/12) |
| `npm run test:ads-pro:foundation` / `:final` (audit 17, style 11, document 11, photo 9, layout 13, variations 13, **state 17, cutout 12, persistence 9, flow 15**) | PASS |
| `npm run test:ads-pro:mutation` (manifest 10/10 mutações mortas após refatorar âncoras) | PASS |
| `npm run test:firebase` (regras Firestore/Storage + 8 novos casos de `proDocument`) | PASS |
| `npm run test:plan-impl-05` (cota/idempotência no servidor, emulador: Q1–Q9, R, SC, F, **C1–C3 concorrência/idempotência**, PT, M, S, UI) | PASS |
| Corrente `npm test` item a item (exceto smoke) | todos PASS, exceto 2 itens de ambiente/baseline (abaixo) |
| `script/smoke-tests.ts` | **8 asserções falham também na canônica pristina** (linhas 4573–4584: regex de onboarding/referral) — mesmas 8 linhas antes/depois; nenhuma nova |
| E2E de runtime `npm run test:e2e:ads-pro-final` | PASS (1 teste, ~37 s, app real + emuladores) |

Itens vermelhos **que já eram vermelhos na canônica** (medido num worktree limpo de `10f0f4e`):

- `npm run performance:bundle-check`: CSS 181,37 kB > 180; total JS 2603,73 kB > 2600; gzip 801,24 kB > 800.
  Depois desta entrega: CSS 182,53 (+1,16: classes novas do estúdio), total JS 2730,55 (+126,8: chunk lazy do
  estúdio, 129,1 kB / 42,25 kB gzip), gzip 842,7. **Boot inicial e rota `marketing` continuam dentro do budget**
  (marketing 235,17/236 kB — menor que a linha de base, 235,3). Nenhum budget foi alterado.
- `npm run test:bundle-budgets` (P6 usa o build real contra o checker real): falha pelos mesmos tetos.
- `npm run test:dashboard-runtime-resilience`: o Playwright do projeto pede um Chromium de outra versão que esta
  máquina não tem (ambiente, não código).
- `smoke-tests.ts`: as 8 asserções acima. As **5 asserções do antigo roadmap "Em desenvolvimento"** que quebraram com
  esta entrega foram atualizadas para o novo comportamento (continuam exigindo que toda ferramenta anunciada tenha
  implementação real e que nada se declare "em desenvolvimento"); SEC-05 agora prova que o perfil chega ao estúdio.

## 7. Prova de runtime (Playwright, app real)

`npm run test:e2e:ads-pro-final` (sobe emuladores Auth/Firestore/Storage, a API de produção e o Vite; nesta máquina:
`E2E_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium npm run test:e2e:ads-pro-final`). Percorre num celular 360×740
(+ 320×568 e desktop 1280×900): três opções diferentes (assinaturas distintas), melhorar foto + "ver original",
recorte local, **quiz de estilo mudando o estilo da primeira opção**, comparar, "outras opções", troca de fundo,
edição + desfazer, layout (sem rolagem lateral, abas ≥ 44 px, prévia fixa), salvar duas vezes = **1 registro** no
Firestore com `proDocument`, **PNG 1080×1350 e 1080×1080 com checagem de pixels**, compartilhar (fallback honesto e
Web Share com arquivo simulado), cancelar o seletor, reabrir após recarregar, desktop em duas colunas, produto sem
foto (avisa e bloqueia exportar). Falha se qualquer endpoint pago (`/api/marketing/pro/generate`, PhotoRoom,
reserva/consumo de cota) for tocado ou se o console tiver erro.

Provas visuais (fora do Git): `.tmp/ads-pro-final-proof/` — `01-mobile-options.png` … `12-mobile-no-photo.png`,
`export-portrait-1080x1350.png`, `export-square-1080x1080.png`, `10-desktop-studio.png`, `11-desktop-options.png`.

## 8. Limitações reais

1. **309 fundos não auditados** (branch de assets ausente) — §5. Até lá o produto usa os 12 fundos gerados.
2. **Compartilhamento nativo (Capacitor/Android) não foi executado em aparelho**: o caminho reaproveita
   `marketing-share.ts` (já existente); na web foram provados Web Share com arquivo, fallback e cancelamento.
3. **Regras do Firestore não foram publicadas** (proibido sem autorização). Sem publicar `firestore.rules`, o app
   salva imagem + histórico e **avisa** que não conseguiu guardar a edição ("saved-without-project") — reabrir para
   editar só funciona depois que as regras forem publicadas por você.
4. Recorte local só funciona bem com fundo liso (flood-fill); falha com mensagem e o anúncio segue com a foto.
5. Existem **dois sistemas de perfil**: o assistente antigo PRO-10B (`SellerCreativeProfile`, abre sozinho para
   Premium novo e agora fica em "Ferramentas avançadas") e o quiz Ads Pro (`AdsProCreativeProfileV1`) que alimenta
   o estúdio. Unificar é decisão de produto — não mexi.
6. Fontes do sistema: a aparência varia levemente entre sistemas (medição e exportação usam a mesma fonte do aparelho).
7. A aba Pro continua exclusiva do admin (gating existente).
8. Gates globais já vermelhos na canônica (§6) continuam vermelhos.

## 9. Próximos passos sugeridos

1. Publicar `origin/recovery/ads-pro-assets-2026-10-06` e rodar §5 (relatório com as 6 contagens + classificação).
2. Publicar as regras (`firestore.rules`) quando decidir — o app já degrada com aviso enquanto isso.
3. Decidir sobre os tetos de bundle da canônica (já violados antes desta jornada) e sobre unificar os dois perfis.
4. Testar compartilhar/exportar num Android real (APK de debug) antes do próximo release.
