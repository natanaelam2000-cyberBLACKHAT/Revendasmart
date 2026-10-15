/**
 * PROMOTIONAL-CAMPAIGNS-01 §31/§32 — testes das funções puras de domínio (`shared/promotional-campaigns.ts`).
 * Nenhum Firestore aqui — a parte que depende de rede/emulador (claim atômico, concorrência, admin gate,
 * cross-owner) está em `script/promotional-campaigns-owner-access-tests.ts`, atrás de
 * `npm run test:promotional-campaigns` (mesmo padrão de `owner-access-02-tests.ts`).
 */
import assert from "node:assert/strict";
import {
  calculateAmountUntilNextEntry,
  calculateAvailableEntries,
  calculateEarnedEntries,
  calculateEntitlement,
  formatCampaignNumber,
  isCampaignPubliclyClaimable,
  MAX_CAMPAIGN_NUMBERS,
  validateClaimPayloadShape,
  validateNumberCount,
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

  // Concessão explícita do admin é a fonte do limite por cliente; ainda respeita o que já foi usado.
  const assignedEntitlement = calculateEntitlement(0, 100, 2, 5);
  assert.equal(assignedEntitlement.entriesEarned, 5);
  assert.equal(assignedEntitlement.entriesAvailable, 3);

  assert.equal(calculateEntitlement(99999, 100, 1, 2).entriesAvailable, 1);
  assert.equal(calculateEntitlement(99999, 100, 1, 0).entriesAvailable, 0);
  assert.equal(calculateEntitlement(350, 100, 1).entriesAvailable, 2);
  for (const invalid of [NaN, Infinity, 1.5]) assert.equal(validateClaimPayloadShape({ numbers: [invalid], numberStart: 1, numberEnd: 100, entriesAvailable: 3 }), "NUMBER_OUT_OF_RANGE");

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

  console.log("PROMOTIONAL-CAMPAIGNS-01 pure-function tests passed: entries calculation exact per ticket table, accumulated spend, remaining-until-next-entry, entitlement composite scenario, number formatting, claim payload shape validation (exceeds/duplicate/out-of-range/empty/valid), status+period gate.");
}

run();
