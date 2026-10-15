import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  draftFromWeeklyHours,
  emptyWeeklyDraft,
  validateWeeklyDraft,
  weeklyHoursFromDraft,
} from "../client/src/lib/service-agenda-helpers";
import type { WeeklyHours } from "../shared/service-availability";

/**
 * SERV-UI-02 §27 — testes focados da tela de configuração de disponibilidade: helpers puros com testes
 * reais (round-trip do rascunho de expediente, validação de overlap client-side), e source-text assertions
 * só para o que é prova estrutural (A6/A12/A13/A14/A15 — quais comandos são chamados, nunca escrita direta
 * no Firestore), mesmo padrão já usado em script/services-agenda-ui-tests.ts (nenhuma lib de testing de
 * componente instalada neste projeto).
 */
function read(path: string): string {
  return readFileSync(path, "utf8");
}

function closedWeek(): WeeklyHours {
  return { sunday: [], monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [] };
}

function run() {
  // ===== A2 — dia fechado aparece corretamente (rascunho vazio = todos os dias fechados) =====
  {
    const draft = emptyWeeklyDraft();
    for (const day of ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const) {
      assert.deepEqual(draft[day], [], `A2: ${day} deve começar fechado (sem períodos)`);
    }
  }

  // ===== A1 — schedule existente carrega na UI (draftFromWeeklyHours popula o rascunho a partir do
  // schedule real) + A3/A4 (o rascunho é a mesma estrutura que addPeriod/removePeriod manipulam) =====
  {
    const weeklyHours: WeeklyHours = {
      ...closedWeek(),
      monday: [{ start: "08:00", end: "12:00" }, { start: "13:00", end: "18:00" }],
      tuesday: [{ start: "08:00", end: "18:00" }],
    };
    const draft = draftFromWeeklyHours(weeklyHours);
    assert.equal(draft.monday.length, 2, "A1: segunda carrega os 2 períodos salvos");
    assert.equal(draft.monday[0].start, "08:00");
    assert.equal(draft.monday[0].end, "12:00");
    assert.equal(draft.tuesday.length, 1);
    assert.equal(draft.sunday.length, 0, "A1: domingo (fechado) carrega vazio");
    // Cada período ganha um id local ESTÁVEL (necessário para addPeriod/removePeriod por key React, A3/A4).
    assert.ok(draft.monday[0].id, "A1/A3/A4: cada período do rascunho tem um id local para a lista React");
    assert.notEqual(draft.monday[0].id, draft.monday[1].id, "ids distintos entre períodos do mesmo dia");

    // A4 — remover um período do rascunho (mesma operação que o botão de remover faz: filtrar por id).
    const afterRemoval = { ...draft, monday: draft.monday.filter((period) => period.id !== draft.monday[0].id) };
    assert.equal(afterRemoval.monday.length, 1, "A4: remover um período reduz a lista em 1");
    assert.equal(afterRemoval.monday[0].start, "13:00", "A4: o período restante é o correto");

    // A3 — adicionar um período novo (mesma operação que o botão de adicionar faz: push).
    const afterAdd = { ...draft, wednesday: [...draft.wednesday, { id: "new-1", start: "09:00", end: "17:00" }] };
    assert.equal(afterAdd.wednesday.length, 1, "A3: adicionar um período em um dia fechado o torna ativo");

    // weeklyHoursFromDraft é o inverso exato de draftFromWeeklyHours (round-trip completo do expediente).
    const roundTripped = weeklyHoursFromDraft(draft);
    assert.deepEqual(roundTripped.monday, weeklyHours.monday, "round-trip: segunda idêntica após ida e volta");
    assert.deepEqual(roundTripped.tuesday, weeklyHours.tuesday);
    assert.deepEqual(roundTripped.sunday, []);
  }

  // ===== A5 — overlap client-side rejeitado (mesma regra que o backend aplica, ver §6/§7) =====
  {
    const overlapping = { ...emptyWeeklyDraft(), monday: [{ id: "1", start: "08:00", end: "12:00" }, { id: "2", start: "11:00", end: "15:00" }] };
    const message = validateWeeklyDraft(overlapping);
    assert.ok(message, "A5: períodos sobrepostos devem ser rejeitados no client antes de salvar");
    assert.match(message!, /sobrepostos/, "A5: mensagem clara sobre sobreposição");
  }
  {
    // Adjacentes (boundary) NÃO são overlap — mesma semântica [start,end) do resto do domínio.
    const adjacent = { ...emptyWeeklyDraft(), monday: [{ id: "1", start: "08:00", end: "12:00" }, { id: "2", start: "12:00", end: "18:00" }] };
    assert.equal(validateWeeklyDraft(adjacent), null, "A5: períodos adjacentes (boundary) são válidos, não overlap");
  }
  {
    // start >= end também é rejeitado (ordem inválida).
    const invalidOrder = { ...emptyWeeklyDraft(), tuesday: [{ id: "1", start: "12:00", end: "08:00" }] };
    const message = validateWeeklyDraft(invalidOrder);
    assert.ok(message, "A5: início depois do fim também deve ser rejeitado");
  }
  {
    const valid = { ...emptyWeeklyDraft(), monday: [{ id: "1", start: "08:00", end: "12:00" }, { id: "2", start: "13:00", end: "18:00" }] };
    assert.equal(validateWeeklyDraft(valid), null, "A5: expediente válido (com pausa) não deve ser rejeitado");
  }

  console.log("Services availability settings pure-function tests passed: closed-day default (A2), schedule loads into a stable-id draft with correct round-trip (A1, A3/A4 data model), and client-side overlap/order validation matching the same [start,end) semantics as the backend, including the adjacent-boundary non-overlap case (A5).");

  // ===== A6/A7/A8/A9/A10/A11/A12/A13/A14/A15 — provas estruturais sobre o componente real =====
  const settingsSource = read("client/src/pages/service-availability-settings.tsx");

  // A6/A7/A8/A9/A10 — salvar chama o comando real com timezone/slotStep/minAdvance/maxAdvance/weeklyHours.
  assert.match(settingsSource, /import \{ createServiceAvailabilityBlock, deleteServiceAvailabilityBlock, upsertServiceResourceSchedule \} from "@\/lib\/service-availability-commands"/, "A6: usa os comandos server-side reais, nunca uma nova implementação");
  assert.match(settingsSource, /await upsertServiceResourceSchedule\(DEFAULT_RESOURCE_ID, \{\s*timezone, slotStepMinutes, minAdvanceMinutes, maxAdvanceDays, weeklyHours: weeklyHoursFromDraft\(weeklyDraft\),\s*\}\)/, "A6/A7/A8/A9/A10: salvar envia timezone/slotStep/minAdvance/maxAdvance/weeklyHours reais ao comando real");
  assert.match(settingsSource, /setTimezone\(schedule\.timezone\)/, "A10: timezone carregado do schedule real");
  assert.match(settingsSource, /setSlotStepMinutes\(schedule\.slotStepMinutes\)/, "A7: slotStep carregado do schedule real");
  assert.match(settingsSource, /setMinAdvanceMinutes\(schedule\.minAdvanceMinutes\)/, "A8: minAdvance carregado do schedule real");
  assert.match(settingsSource, /setMaxAdvanceDays\(schedule\.maxAdvanceDays\)/, "A9: maxAdvance carregado do schedule real");
  assert.match(settingsSource, /value=\{15\}>15 minutos/);
  assert.match(settingsSource, /value=\{30\}>30 minutos/);

  // A11 — blocks listados: só os futuros (endAt >= agora), ordenados por startAt.
  assert.match(settingsSource, /\.filter\(\(block\) => Date\.parse\(block\.endAt\) >= Date\.now\(\)\)/, "A11: só bloqueios futuros/relevantes são listados (nunca o histórico inteiro, §22)");
  assert.match(settingsSource, /\.sort\(\(a, b\) => Date\.parse\(a\.startAt\) - Date\.parse\(b\.startAt\)\)/, "A11: bloqueios listados em ordem cronológica");

  // A12/A13 — criar/remover bloqueio chamam os comandos reais.
  assert.match(settingsSource, /await createServiceAvailabilityBlock\(\{ resourceId: DEFAULT_RESOURCE_ID, startAt, endAt, reason: blockReason \|\| undefined \}\)/, "A12: criar bloqueio chama o comando server-side real");
  assert.match(settingsSource, /await deleteServiceAvailabilityBlock\(deletingBlockId\)/, "A13: remover bloqueio chama o comando server-side real");

  // §18 — conflito de block traduzido para mensagem útil (nunca código bruto exposto).
  assert.match(read("client/src/lib/service-agenda-helpers.ts"), /BLOCK_CONFLICT_WITH_BOOKING.*Existe um atendimento agendado/);
  assert.match(read("client/src/lib/service-agenda-helpers.ts"), /BLOCK_CONFLICT_WITH_ACTIVE_HOLD.*temporariamente reservado/);

  // A14 — nenhuma escrita direta no Firestore: só os comandos server-side.
  assert.doesNotMatch(settingsSource, /\bsetDoc\b|\bupdateDoc\b|\bdeleteDoc\b|\baddDoc\b/, "A14: a tela nunca escreve ResourceSchedule/Block direto no Firestore — só via comandos server-side");
  assert.doesNotMatch(settingsSource, /from "firebase\/firestore"/, "A14: nenhum import do SDK de escrita do Firestore nesta página");

  // A15 — Agenda tem CTA real para a configuração, e a rota aponta para a tela funcional (não mais o placeholder).
  const agendaSource = read("client/src/pages/service-agenda.tsx");
  assert.match(agendaSource, /href="\/servicos\/disponibilidade"/, "A15: a Agenda tem um link real para /servicos/disponibilidade");
  const routerSource = read("client/src/routers/PrivateRouter.tsx");
  assert.match(routerSource, /const ServiceAvailabilitySettings = lazy\(\(\) => import\("@\/pages\/service-availability-settings"\)\)/, "AVAILABILITY_SETTINGS_ROUTE_LAZY: a rota precisa continuar lazy-loaded");
  assert.match(routerSource, /<Route path="\/servicos\/disponibilidade" component=\{ServiceAvailabilitySettings\} \/>/, "a rota /servicos/disponibilidade precisa estar registrada");

  // §26 — nenhuma dependência nova de calendário/gráfico.
  assert.doesNotMatch(settingsSource, /recharts/i, "RECHARTS_IMPORTED deve ser NO nesta tela também");
  assert.doesNotMatch(settingsSource, /full-?calendar|react-big-calendar|daypilot|syncfusion/i, "nenhuma lib de calendário pesada");
  // §9/§26 — <select> nativo em vez do Select do design system (ver comentário no próprio arquivo): evita
  // reintroduzir @radix-ui/react-select, que nunca foi usado em nenhuma outra tela deste app.
  assert.doesNotMatch(settingsSource, /from "@\/components\/ui\/select"/, "nenhum novo uso de @radix-ui/react-select nesta tela (custo de bundle documentado no arquivo)");

  console.log("Services availability settings structural tests passed: save/create-block/delete-block use only the existing server-side commands (never a direct Firestore write, A14), timezone/slot-step/min-advance/max-advance round-trip through the real schedule object (A6-A10), upcoming blocks are filtered to future-only and chronologically sorted (A11), block conflict errors are translated to useful messages (§18), the Agenda's CTA and the route both point to the now-functional settings page (A15, still lazy-loaded), and no calendar library or Radix Select was reintroduced.");
}

run();
