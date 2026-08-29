/**
 * PROMOTIONAL-CAMPAIGNS-01 §31/§32 — testes das funções puras de domínio (`shared/promotional-campaigns.ts`).
 * Nenhum Firestore aqui — a parte que depende de rede/emulador (claim atômico, concorrência, admin gate,
 * cross-owner) está em `script/promotional-campaigns-owner-access-tests.ts`, atrás de
 * `npm run test:owner-access` (mesmo padrão de `owner-access-02-tests.ts`).
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  buildEligibleEntries,
  calculateAmountUntilNextEntry,
  calculateAvailableEntries,
  calculateEarnedEntries,
  calculateEntitlement,
  calculateEntitlementWithManualGrants,
  calculateMaxSelectable,
  buildDrawAnimationBalls,
  calculateTokenRemaining,
  canonicalEligibleSetString,
  countDistinctParticipants,
  formatCampaignNumber,
  resolveInitialDrawAnimationResult,
  DRAW_ANIMATION_PHASE_MS,
  DRAW_ANIMATION_REDUCED_PHASE_MS,
  isCampaignClosable,
  isCampaignDrawable,
  isCampaignPubliclyClaimable,
  isEntitlementPolicy,
  isManualGrantReason,
  isPromotionalCampaignStatus,
  MAX_CAMPAIGN_NUMBERS,
  validateClaimPayloadShape,
  validateManualGrantQuantity,
  validateNumberCount,
  validateSelectionLimit,
} from "../shared/promotional-campaigns";

function run(): void {
  // ===== §8/§32 — cálculo de direitos conquistados, valores exatos exigidos pelo ticket =====
  assert.equal(calculateEarnedEntries(0, 100), 0);
  assert.equal(calculateEarnedEntries(99, 100), 0);
  assert.equal(calculateEarnedEntries(100, 100), 1);
  assert.equal(calculateEarnedEntries(199, 100), 1);
  assert.equal(calculateEarnedEntries(200, 100), 2);
  assert.equal(calculateEarnedEntries(250, 100), 2);
  assert.equal(calculateEarnedEntries(570, 100), 5);
  assert.equal(calculateEarnedEntries(1000, 100), 10);

  // ===== §8 — compras acumuladas: 60 + 70 = 130 = 1 participação (a soma é feita pelo chamador; a
  // função só recebe o total já somado). A "sobra lógica" do ticket (R$ 30 já contam para o próximo
  // direito) é o RESTO da divisão — calculateAmountUntilNextEntry devolve o complemento (§29: "Faltam
  // R$ X para ganhar mais 1 número"), que para R$130/R$100 é R$70 (100 - 30 de resto). =====
  assert.equal(calculateEarnedEntries(60 + 70, 100), 1);
  assert.equal(130 % 100, 30, "resto (sobra lógica já contabilizada) bate com o exemplo do ticket");
  assert.equal(calculateAmountUntilNextEntry(130, 100), 70, "complemento do resto — quanto FALTA para o próximo direito");

  // ===== entriesAvailable = entriesEarned - entriesAlreadyClaimed (nunca negativo) =====
  assert.equal(calculateAvailableEntries(3, 0), 3);
  assert.equal(calculateAvailableEntries(3, 2), 1);
  assert.equal(calculateAvailableEntries(3, 5), 0, "nunca fica negativo mesmo com dado inconsistente");

  // ===== §8 — cenário composto: R$350, spendPerEntry=100, 2 já usados => earned=3, claimed=2, available=1 =====
  const entitlement = calculateEntitlement(350, 100, 2);
  assert.equal(entitlement.entriesEarned, 3);
  assert.equal(entitlement.entriesAlreadyClaimed, 2);
  assert.equal(entitlement.entriesAvailable, 1);

  // ===== §15 — formatCampaignNumber: "0"->"00", "7"->"07", "100"->"100", sempre integer internamente =====
  assert.equal(formatCampaignNumber(0), "00");
  assert.equal(formatCampaignNumber(7), "07");
  assert.equal(formatCampaignNumber(99), "99");
  assert.equal(formatCampaignNumber(100), "100");

  // ===== §32 — payload de claim: available=3, escolher 4 => DENY =====
  assert.equal(
    validateClaimPayloadShape({ numbers: [1, 2, 3, 4], numberStart: 0, numberEnd: 100, entriesAvailable: 3 }),
    "EXCEEDS_AVAILABLE_ENTRIES",
  );
  // [12,12,38] => DENY (duplicado no payload)
  assert.equal(
    validateClaimPayloadShape({ numbers: [12, 12, 38], numberStart: 0, numberEnd: 100, entriesAvailable: 3 }),
    "DUPLICATE_NUMBER_IN_PAYLOAD",
  );
  // range 0-100, 101 => DENY
  assert.equal(
    validateClaimPayloadShape({ numbers: [101], numberStart: 0, numberEnd: 100, entriesAvailable: 3 }),
    "NUMBER_OUT_OF_RANGE",
  );
  // payload vazio => DENY
  assert.equal(
    validateClaimPayloadShape({ numbers: [], numberStart: 0, numberEnd: 100, entriesAvailable: 3 }),
    "NO_NUMBERS_SELECTED",
  );
  // payload válido dentro do range e do limite de direitos => ALLOW (null = sem motivo de recusa)
  assert.equal(
    validateClaimPayloadShape({ numbers: [12, 38, 67], numberStart: 0, numberEnd: 100, entriesAvailable: 3 }),
    null,
  );

  // ===== §12/§32 — só claimable quando status active E dentro do período =====
  const now = new Date("2026-06-15T12:00:00Z");
  assert.equal(isCampaignPubliclyClaimable({ status: "draft", startsAt: "2026-06-01T00:00:00Z", endsAt: "2026-06-30T00:00:00Z" }, now), false);
  assert.equal(isCampaignPubliclyClaimable({ status: "paused", startsAt: "2026-06-01T00:00:00Z", endsAt: "2026-06-30T00:00:00Z" }, now), false);
  assert.equal(isCampaignPubliclyClaimable({ status: "finished", startsAt: "2026-06-01T00:00:00Z", endsAt: "2026-06-30T00:00:00Z" }, now), false);
  assert.equal(isCampaignPubliclyClaimable({ status: "active", startsAt: "2026-07-01T00:00:00Z", endsAt: "2026-07-30T00:00:00Z" }, now), false, "fora do período => DENY");
  assert.equal(isCampaignPubliclyClaimable({ status: "active", startsAt: "2026-06-01T00:00:00Z", endsAt: "2026-06-30T00:00:00Z" }, now), true, "ativo e dentro do período => ALLOW");

  // ===== PROMOTIONAL-CAMPAIGNS-02 §9 — quantidade de números personalizável =====
  assert.equal(validateNumberCount(1), 1);
  assert.equal(validateNumberCount(10), 10);
  assert.equal(validateNumberCount(50), 50);
  assert.equal(validateNumberCount(100), 100);
  assert.equal(validateNumberCount(250), 250);
  assert.equal(validateNumberCount(500), 500);
  assert.equal(validateNumberCount(MAX_CAMPAIGN_NUMBERS), MAX_CAMPAIGN_NUMBERS, "no limite técnico exato => válido");
  assert.equal(validateNumberCount(MAX_CAMPAIGN_NUMBERS + 1), null, "acima do limite técnico => rejeitado");
  assert.equal(validateNumberCount(0), null, "numberCount = 0 => rejeitado");
  assert.equal(validateNumberCount(-10), null, "negativo => rejeitado");
  assert.equal(validateNumberCount(10.5), null, "decimal => rejeitado");
  assert.equal(validateNumberCount("abc"), null, "não numérico => rejeitado");

  // ===== §5 — formatCampaignNumber com faixa que começa em 1 (00 nunca existe em campanhas novas) =====
  assert.equal(formatCampaignNumber(1), "01");
  assert.equal(formatCampaignNumber(9), "09");
  assert.equal(formatCampaignNumber(10), "10");
  assert.equal(formatCampaignNumber(250), "250");

  // ===== PROMOTIONAL-CAMPAIGNS-LINK-SELECTION-LIMIT-04 — validação pura de selectionLimit (testes C/D/E/F
  // do ticket: nunca cria direitos, só decide quantos dos já existentes um link libera) =====
  assert.equal(validateSelectionLimit(3, 5), 3, "dentro do range => válido");
  assert.equal(validateSelectionLimit(5, 5), 5, "no limite exato do saldo disponível => válido");
  assert.equal(validateSelectionLimit(6, 5), null, "C: limit > available => reject");
  assert.equal(validateSelectionLimit(0, 5), null, "D: limit=0 => reject");
  assert.equal(validateSelectionLimit(-1, 5), null, "E: limit negativo => reject");
  assert.equal(validateSelectionLimit(2.5, 5), null, "F: limit decimal => reject");
  assert.equal(validateSelectionLimit("abc", 5), null, "não numérico => reject");
  assert.equal(validateSelectionLimit(1, 0), null, "sem saldo disponível => nenhum valor é válido");

  // ===== calculateTokenRemaining / calculateMaxSelectable — teto por token nunca isolado do saldo global =====
  assert.equal(calculateTokenRemaining(null, 0), null, "link legado (sem selectionLimit) => sem teto próprio");
  assert.equal(calculateTokenRemaining(3, 0), 3, "teto=3, nada usado ainda => 3 restantes");
  assert.equal(calculateTokenRemaining(3, 1), 2, "teto=3, 1 já usado neste token => 2 restantes");
  assert.equal(calculateTokenRemaining(3, 3), 0, "teto=3, todos os 3 já usados neste token => 0 restantes");
  assert.equal(calculateTokenRemaining(3, 5), 0, "nunca fica negativo mesmo com dado inconsistente");

  assert.equal(calculateMaxSelectable(5, null), 5, "link legado => capado só pelo saldo global");
  assert.equal(calculateMaxSelectable(5, 3), 3, "teto do token (3) é menor que o saldo global (5) => 3");
  assert.equal(calculateMaxSelectable(2, 4), 2, "H: saldo global (2) é menor que o teto do token (4) => 2 — nunca confia isoladamente no token");
  assert.equal(calculateMaxSelectable(0, 4), 0, "saldo global zerado => 0 mesmo com teto de token positivo");

  // ===== PROMOTIONAL-CAMPAIGNS-MANUAL-INTERNAL-05 — policy/quantity validation =====
  assert.equal(isEntitlementPolicy("INTERNAL_ADMIN"), true);
  assert.equal(isEntitlementPolicy("REGISTERED_SALES_ONLY"), true);
  assert.equal(isEntitlementPolicy("SOMETHING_ELSE"), false);
  assert.equal(isEntitlementPolicy(undefined), false);

  assert.equal(isManualGrantReason("external_magazine_sale"), true);
  assert.equal(isManualGrantReason("courtesy"), true);
  assert.equal(isManualGrantReason("bogus"), false);

  assert.equal(validateManualGrantQuantity(3), 3);
  assert.equal(validateManualGrantQuantity(0), null, "6: quantity=0 => reject");
  assert.equal(validateManualGrantQuantity(-1), null, "5: quantity negativo => reject");
  assert.equal(validateManualGrantQuantity(1.5), null, "7: quantity decimal => reject");
  assert.equal(validateManualGrantQuantity("abc"), null, "não numérico => reject");

  // ===== calculateEntitlementWithManualGrants — §18 fixture exata do ticket =====
  // Moises: qualifyingSpend=200, spendPerEntry=100 => automatic=2; manual=3 concedidos => total=5.
  {
    const entitlement = calculateEntitlementWithManualGrants({
      qualifyingSpend: 200, spendPerEntry: 100, manualInternalEntries: 3, entriesAlreadyClaimed: 0, policy: "INTERNAL_ADMIN",
    });
    assert.equal(entitlement.automaticEntries, 2, "§18: automatic = floor(200/100) = 2");
    assert.equal(entitlement.manualInternalEntries, 3, "§18: manual concedido = 3");
    assert.equal(entitlement.entriesEarned, 5, "§18: total = automatic + manual = 5");
    assert.equal(entitlement.entriesAvailable, 5, "§18: nada ainda escolhido => 5 disponíveis");
    assert.equal(entitlement.qualifyingSpend, 200, "§4 REGRA CRÍTICA: qualifyingSpend nunca muda por causa da concessão manual");
  }
  // Depois de escolher os 5 números: available = 0.
  {
    const entitlement = calculateEntitlementWithManualGrants({
      qualifyingSpend: 200, spendPerEntry: 100, manualInternalEntries: 3, entriesAlreadyClaimed: 5, policy: "INTERNAL_ADMIN",
    });
    assert.equal(entitlement.entriesAvailable, 0, "§18: claimed=5 == earned=5 => 0 disponíveis");
  }
  // REGISTERED_SALES_ONLY — manual_internal é sempre ignorado, mesmo que o evento exista (defesa em profundidade, §2/§13).
  {
    const entitlement = calculateEntitlementWithManualGrants({
      qualifyingSpend: 200, spendPerEntry: 100, manualInternalEntries: 3, entriesAlreadyClaimed: 0, policy: "REGISTERED_SALES_ONLY",
    });
    assert.equal(entitlement.manualInternalEntries, 0, "REGISTERED_SALES_ONLY: manual nunca conta, mesmo com evento existente");
    assert.equal(entitlement.entriesEarned, 2, "REGISTERED_SALES_ONLY: total = só automatic");
  }
  // manualInternalEntries negativo (ajuste compensatório futuro) nunca deixa o total ficar negativo.
  {
    const entitlement = calculateEntitlementWithManualGrants({
      qualifyingSpend: 0, spendPerEntry: 100, manualInternalEntries: -5, entriesAlreadyClaimed: 0, policy: "INTERNAL_ADMIN",
    });
    assert.equal(entitlement.manualInternalEntries, 0, "ajuste líquido negativo nunca produz manualInternalEntries negativo exposto");
    assert.equal(entitlement.entriesAvailable, 0);
  }

  console.log("PROMOTIONAL-CAMPAIGNS-01 pure-function tests passed: entries calculation exact per ticket table, accumulated spend, remaining-until-next-entry, entitlement composite scenario, number formatting, claim payload shape validation (exceeds/duplicate/out-of-range/empty/valid), status+period gate, link selection limit validation, token-remaining/max-selectable never trust either cap in isolation, manual-internal policy/quantity validation, manual-grant entitlement composition (automatic+manual, qualifyingSpend untouched, REGISTERED_SALES_ONLY ignores manual).");

  // ===== PROMOTIONAL-CAMPAIGNS-SECURE-DRAW-06 §24 — motor de apuração (funções puras) =====

  // status/transições
  assert.equal(isPromotionalCampaignStatus("entries_closed"), true);
  assert.equal(isPromotionalCampaignStatus("drawn"), true);
  assert.equal(isPromotionalCampaignStatus("bogus"), false);
  assert.equal(isCampaignClosable("active"), true, "§3: active pode encerrar");
  assert.equal(isCampaignClosable("paused"), true, "§3: paused pode encerrar");
  assert.equal(isCampaignClosable("draft"), false);
  assert.equal(isCampaignClosable("entries_closed"), false, "não encerra de novo");
  assert.equal(isCampaignClosable("drawn"), false);
  assert.equal(isCampaignDrawable("entries_closed"), true, "§8: só sorteia depois de encerrar");
  assert.equal(isCampaignDrawable("active"), false);
  assert.equal(isCampaignDrawable("paused"), false);
  assert.equal(isCampaignDrawable("draft"), false);
  assert.equal(isCampaignDrawable("drawn"), false, "não sorteia de novo");
  // LEGACY-FINISHED-DRAW-06B §8 — "finished" pelo fluxo antigo também é elegível para apuração (o server
  // só chama isto depois de confirmar que nenhum draw oficial já existe — ver testes de integração).
  assert.equal(isCampaignDrawable("finished"), true, "LEGACY-FINISHED-DRAW-06B: campanha legada finished também pode ser sorteada");

  // §24.1/§24.2 — campanha com 5 números claimed, snapshot contém exatamente 5
  {
    const eligible = buildEligibleEntries([
      { number: 18, customerId: "joao" },
      { number: 7, customerId: "moises" },
      { number: 39, customerId: "moises" },
      { number: 2, customerId: "ana" },
      { number: 91, customerId: "moises" },
    ]);
    assert.equal(eligible.length, 5, "§24.2: snapshot contém exatamente os 5 números claimed");
    assert.deepEqual(eligible.map((e) => e.number), [2, 7, 18, 39, 91], "§17: sempre ordenado crescente, nunca a ordem de leitura do Firestore");
    assert.equal(countDistinctParticipants(eligible), 3, "§5: Moises tem 3 chances mas é 1 participante — 3 clientes distintos no total");
  }

  // §24.3 — unclaimed não entra: buildEligibleEntries só recebe o que já foi filtrado como claimed pelo
  // chamador (server); aqui confirmamos que a função não inventa entradas além do que foi passado.
  {
    const eligible = buildEligibleEntries([{ number: 5, customerId: "moises" }]);
    assert.equal(eligible.length, 1);
  }

  // §24.4/§24.5 — origem (manual_internal vs registered_sale) não altera a elegibilidade: a função nem
  // recebe a origem como input, só number+customerId — prova estrutural de que a apuração é cega à origem.
  {
    const eligible = buildEligibleEntries([
      { number: 1, customerId: "cliente-venda-registrada" },
      { number: 2, customerId: "cliente-manual-internal" },
    ]);
    assert.equal(eligible.length, 2, "§22: manual_internal e registered_sale são igualmente elegíveis");
  }

  // §24.14 — eligibleSetHash determinístico: mesmo conjunto (em qualquer ordem de entrada) => mesmo hash.
  {
    const setA = buildEligibleEntries([{ number: 7, customerId: "moises" }, { number: 2, customerId: "ana" }, { number: 18, customerId: "joao" }]);
    const setB = buildEligibleEntries([{ number: 18, customerId: "joao" }, { number: 7, customerId: "moises" }, { number: 2, customerId: "ana" }]);
    const hashA = crypto.createHash("sha256").update(canonicalEligibleSetString(setA)).digest("hex");
    const hashB = crypto.createHash("sha256").update(canonicalEligibleSetString(setB)).digest("hex");
    assert.equal(hashA, hashB, "§17: mesmo conjunto elegível => mesmo eligibleSetHash, independente da ordem de leitura");

    const setC = buildEligibleEntries([{ number: 7, customerId: "moises" }, { number: 2, customerId: "ana" }, { number: 19, customerId: "joao" }]);
    const hashC = crypto.createHash("sha256").update(canonicalEligibleSetString(setC)).digest("hex");
    assert.notEqual(hashA, hashC, "conjunto diferente (19 em vez de 18) produz hash diferente — o hash é sensível ao conteúdo real");
  }

  console.log("PROMOTIONAL-CAMPAIGNS-SECURE-DRAW-06 pure-function tests passed: status transitions (closable/drawable), eligible-set construction (sorted, origin-blind, distinct-participant count), eligibleSetHash deterministic and content-sensitive. LEGACY-FINISHED-DRAW-06B: legacy finished status is drawable (active/paused/draft/drawn remain blocked).");

  // ==================================================================================================
  // SECURE-DRAW-VISUAL-07 §21 — a apresentação NUNCA decide o vencedor; a bolinha final revelada é
  // sempre `officialDraw.winningNumber`, vindo de fora, nunca calculado aqui.
  // ==================================================================================================
  {
    // §21.1/§21.2/§21.3 — official result recebido => animação final = official winningNumber, testado
    // com os dois valores exatos citados no ticket (100 e 07).
    const ballsFor100 = buildDrawAnimationBalls(1, 100, 100, 24);
    assert.ok(ballsFor100.includes(100), "§21: o número oficial (100) precisa estar entre as bolinhas — é ele que será revelado no final");
    assert.equal(formatCampaignNumber(100), "100", "§21.2: resultado 100 => final '100'");

    const ballsFor7 = buildDrawAnimationBalls(1, 100, 7, 24);
    assert.ok(ballsFor7.includes(7), "§21: o número oficial (07) precisa estar entre as bolinhas");
    assert.equal(formatCampaignNumber(7), "07", "§21.3: resultado 07 => final '07' (dois dígitos)");

    // Determinístico: rodando 50 vezes com Math.random real, o vencedor está SEMPRE presente — nunca uma
    // corrida de sorte; nunca excede o teto de bolinhas; nunca sai do range da campanha.
    for (let i = 0; i < 50; i += 1) {
      const balls = buildDrawAnimationBalls(1, 50, 33, 24);
      assert.ok(balls.includes(33), "§2: Math.random() decorativo nunca pode fazer o vencedor sumir do globo");
      assert.ok(balls.length <= 24, "nunca excede o teto de bolinhas decorativas");
      assert.ok(balls.every((n) => n >= 1 && n <= 50), "nenhuma bolinha decorativa fora do range da campanha");
    }

    // Range minúsculo (nunca trava em loop infinito tentando preencher mais bolinhas do que existem).
    const tinyRange = buildDrawAnimationBalls(5, 5, 5, 24);
    assert.deepEqual(tinyRange, [5], "range de 1 número: só a bolinha vencedora, sem loop infinito");

    // §21.4/§21.5 — existing draw (modo replay) nunca chama draw: o resultado inicial já vem pronto do
    // officialDraw existente, nunca null (que forçaria uma chamada de rede em modo "new").
    const fakeDraw = {
      drawId: "d1", campaignId: "c1", campaignOwnerId: "o1", closedAt: null, drawnAt: "2026-01-01T00:00:00.000Z",
      eligibleNumberCount: 1, participantCount: 1, algorithm: "crypto.randomInt", algorithmVersion: 1,
      eligibleSetHash: "hash", winningNumber: 100, winningClientId: "natanael-id",
      winnerDisplayNameSnapshot: "natanael", prizeNameSnapshot: "Malbec Eau de Parfum último lançamento",
      prizeImageUrlSnapshot: null, createdBy: "admin",
    };
    assert.equal(resolveInitialDrawAnimationResult("replay", fakeDraw), fakeDraw, "§21.4: modo replay parte direto do resultado já existente — nunca dispara uma nova apuração");
    assert.equal(resolveInitialDrawAnimationResult("new", fakeDraw), null, "§21.5: modo new NUNCA usa um draw pré-existente como se fosse o resultado — só o que o backend responder à chamada real");
    assert.equal(resolveInitialDrawAnimationResult("new", null), null);

    // §21.9/§15 — reduced-motion pula giro contínuo (spinning/decelerating), mas NUNCA pula a contagem
    // nem a revelação — o resultado permanece acessível mesmo com a animação reduzida.
    assert.equal(DRAW_ANIMATION_REDUCED_PHASE_MS.spinning, 0, "§15: reduced-motion pula o giro contínuo do globo");
    assert.equal(DRAW_ANIMATION_REDUCED_PHASE_MS.decelerating, 0, "§15: reduced-motion pula a desaceleração");
    assert.ok(DRAW_ANIMATION_REDUCED_PHASE_MS.countdown > 0, "§15: ainda mostra uma contagem curta, nunca pula direto sem nenhum aviso");
    assert.ok(DRAW_ANIMATION_REDUCED_PHASE_MS.revealNumber > 0 && DRAW_ANIMATION_REDUCED_PHASE_MS.revealWinner > 0, "§15: número e vencedor continuam sendo revelados, só mais rápido");
    assert.ok(DRAW_ANIMATION_PHASE_MS.spinning > 0 && DRAW_ANIMATION_PHASE_MS.decelerating > 0, "sanity: a experiência normal (motion completo) preserva giro e desaceleração reais");
    const totalMs = DRAW_ANIMATION_PHASE_MS.countdown + DRAW_ANIMATION_PHASE_MS.spinning + DRAW_ANIMATION_PHASE_MS.decelerating + DRAW_ANIMATION_PHASE_MS.revealNumber + DRAW_ANIMATION_PHASE_MS.revealWinner;
    assert.ok(totalMs >= 8000 && totalMs <= 11000, `§5: duração total sugerida de 8–11s (medido: ${totalMs}ms)`);
  }
  console.log("PROMOTIONAL-CAMPAIGNS-SECURE-DRAW-VISUAL-07 pure-function tests passed: the winning number is always present among the decorative balls regardless of Math.random() (never disappears, never exceeds the ball cap, never leaves the campaign's number range, never infinite-loops on a 1-number range), formatCampaignNumber renders both exact ticket fixtures (100 and 07), replay mode always resolves its initial result from the existing official draw (never starts from null, which would force a real /draw call), new-draw mode never starts from a pre-existing result (only ever from what the backend actually returns), reduced-motion skips the continuous spin/decelerate loop while still keeping a short countdown and a real reveal, and the full-motion timing table totals within the ticket's suggested 8-11s window. (Double-click safety, network-error handling, and reload persistence were verified live in this round's visual QA — see report.)");
}

run();
