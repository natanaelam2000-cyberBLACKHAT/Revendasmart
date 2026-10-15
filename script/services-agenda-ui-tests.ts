import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  addDaysToDateKey,
  buildAgendaSegments,
  collapseAdjacentSegments,
  computeLocalDayRangeUtc,
  dayOfWeekForDateKeyInTimezone,
  formatTimeInTimezone,
  todayDateKey,
  zonedWallClockToUtcInstant,
} from "../client/src/lib/service-agenda-helpers";
import type { Booking } from "../shared/service-bookings";
import type { ServiceAvailabilityBlock, WeeklyHours } from "../shared/service-availability";

/**
 * SERV-UI-01 §23 — testes focados da Agenda: helpers puros com testes reais (não só source-text), e
 * source-text assertions só para o que realmente é "prova estrutural" (UI4/UI5/UI8 — quais comandos são
 * chamados, nunca escrita direta no Firestore), mesmo padrão já usado no resto do app (nenhuma lib de
 * testing de componente instalada neste projeto).
 */
function read(path: string): string {
  return readFileSync(path, "utf8");
}

function closedWeek(): WeeklyHours {
  return { sunday: [], monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [] };
}

function fixtureBooking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: "booking-1", tenantUid: "uid-1", serviceId: "svc-1", resourceId: "default", workId: "work-1",
    startAt: "2026-08-31T13:00:00.000Z", endAt: "2026-08-31T13:30:00.000Z",
    status: "confirmed", source: "manual", createdAt: "2026-08-31T00:00:00.000Z", updatedAt: "2026-08-31T00:00:00.000Z",
    ...overrides,
  };
}

function fixtureBlock(overrides: Partial<ServiceAvailabilityBlock> = {}): ServiceAvailabilityBlock {
  return {
    id: "block-1", tenantUid: "uid-1", resourceId: "default",
    startAt: "2026-08-31T14:00:00.000Z", endAt: "2026-08-31T14:30:00.000Z", createdAt: "2026-08-31T00:00:00.000Z",
    ...overrides,
  };
}

function run() {
  // ===== Timezone helpers (base de tudo — precisam estar corretos antes do resto) =====
  {
    // 2026-08-31T13:00:00Z em America/Sao_Paulo (UTC-3) é 10:00 local.
    const instant = zonedWallClockToUtcInstant("2026-08-31", 10 * 60, "America/Sao_Paulo");
    assert.equal(instant.toISOString(), "2026-08-31T13:00:00.000Z");
  }
  {
    const { rangeStartAt, rangeEndAt } = computeLocalDayRangeUtc("2026-08-31", "America/Sao_Paulo");
    assert.equal(rangeStartAt, "2026-08-31T03:00:00.000Z", "início do dia local (00:00 SP) em UTC");
    assert.equal(rangeEndAt, "2026-09-01T03:00:00.000Z", "início do dia seguinte, nunca um range maior (§19)");
  }
  assert.equal(addDaysToDateKey("2026-08-31", 1), "2026-09-01");
  assert.equal(addDaysToDateKey("2026-08-31", -1), "2026-08-30");
  assert.equal(dayOfWeekForDateKeyInTimezone("2026-08-31", "America/Sao_Paulo"), 1, "2026-08-31 é segunda-feira");
  assert.equal(dayOfWeekForDateKeyInTimezone("2026-09-06", "America/Sao_Paulo"), 0, "2026-09-06 é domingo");
  assert.equal(typeof todayDateKey(), "string");
  assert.match(todayDateKey(), /^\d{4}-\d{2}-\d{2}$/);
  // PRODUCT-QA-01 — regressão: todayDateKey(timeZone) precisa derivar o dia NO TIMEZONE do resource, nunca
  // no relógio local do processo que roda o teste — do contrário a Agenda mostra o dia errado perto da
  // meia-noite quando o navegador do vendedor está em um timezone diferente do resource (§20).
  {
    // 2026-09-01T03:30:00.000Z: São Paulo (UTC-3) já é 2026-09-01T00:30 -> já virou o dia; no MESMO instante,
    // New York (EDT, UTC-4) ainda é 2026-08-31T23:30 -> ainda o dia anterior. Instante deliberadamente
    // escolhido dentro da janela entre a meia-noite de SP e a de NY, provando que todayDateKey(timeZone) usa
    // o timezone passado, nunca o do processo/navegador.
    const FIXED_INSTANT = "2026-09-01T03:30:00.000Z";
    const RealDate = Date;
    class FixedDate extends RealDate {
      constructor(...args: ConstructorParameters<typeof RealDate>) {
        if (args.length === 0) {
          super(FIXED_INSTANT);
        } else {
          // @ts-expect-error - forwarding varargs to the real Date constructor
          super(...args);
        }
      }
      static now() { return new RealDate(FIXED_INSTANT).getTime(); }
    }
    // @ts-expect-error - test-only global Date substitution, restored immediately after
    globalThis.Date = FixedDate;
    try {
      assert.equal(todayDateKey("America/Sao_Paulo"), "2026-09-01", "já virou o dia em São Paulo");
      assert.equal(todayDateKey("America/New_York"), "2026-08-31", "MESMO instante, timezone diferente -> dia diferente (nunca o do processo)");
    } finally {
      globalThis.Date = RealDate;
    }
  }
  assert.equal(formatTimeInTimezone("2026-08-31T13:00:00.000Z", "America/Sao_Paulo"), "10:00");
  // §20 — MESMO instante, timezone diferente, horário exibido diferente (nunca o do navegador).
  assert.equal(formatTimeInTimezone("2026-08-31T13:00:00.000Z", "America/New_York"), "09:00");

  // ===== UI1 — agenda vazia (sem weeklyHours para o dia) não gera segmentos =====
  {
    const segments = buildAgendaSegments("2026-09-06", "America/Sao_Paulo", closeWeekWithMonday(), [], []);
    assert.deepEqual(segments, [], "UI1: dia fechado (domingo) não gera nenhum segmento — a UI mostra o empty state correspondente");
  }
  {
    const segments = buildAgendaSegments("2026-08-31", "America/Sao_Paulo", undefined, [], []);
    assert.deepEqual(segments, [], "UI1: sem weeklyHours (schedule ausente) também não gera segmentos");
  }

  // ===== UI2 — Booking aparece no horário correto =====
  {
    const booking = fixtureBooking({ startAt: "2026-08-31T13:00:00.000Z", endAt: "2026-08-31T13:30:00.000Z" });
    const segments = buildAgendaSegments("2026-08-31", "America/Sao_Paulo", closeWeekWithMonday(), [booking], []);
    const bookedSegments = segments.filter((segment) => segment.status === "booked");
    assert.ok(bookedSegments.length > 0, "UI2: deve haver ao menos um segmento 'booked'");
    assert.ok(bookedSegments.every((segment) => segment.booking?.id === booking.id), "UI2: o segmento aponta para o Booking real");
    assert.equal(formatTimeInTimezone(bookedSegments[0].startAt, "America/Sao_Paulo"), "10:00", "UI2: horário de exibição bate com o startAt real do Booking (10:00 local)");
  }

  // ===== UI3 — Block aparece como indisponível =====
  {
    const block = fixtureBlock({ startAt: "2026-08-31T14:00:00.000Z", endAt: "2026-08-31T14:30:00.000Z" });
    const segments = buildAgendaSegments("2026-08-31", "America/Sao_Paulo", closeWeekWithMonday(), [], [block]);
    const blockedSegments = segments.filter((segment) => segment.status === "blocked");
    assert.ok(blockedSegments.length > 0, "UI3: deve haver ao menos um segmento 'blocked'");
    assert.ok(blockedSegments.every((segment) => segment.block?.id === block.id), "UI3: o segmento aponta para o Block real");
  }

  // Booking sempre tem prioridade visual sobre Block quando (por algum motivo) coincidem — nunca esconde
  // um agendamento confirmado atrás de um bloqueio.
  {
    const booking = fixtureBooking({ startAt: "2026-08-31T13:00:00.000Z", endAt: "2026-08-31T13:30:00.000Z" });
    const block = fixtureBlock({ startAt: "2026-08-31T13:00:00.000Z", endAt: "2026-08-31T13:30:00.000Z" });
    const segments = buildAgendaSegments("2026-08-31", "America/Sao_Paulo", closeWeekWithMonday(), [booking], [block]);
    const overlapping = segments.find((segment) => segment.startAt === "2026-08-31T13:00:00.000Z");
    assert.equal(overlapping?.status, "booked");
  }

  // collapseAdjacentSegments — segmentos contíguos do MESMO Booking/Block viram uma faixa só.
  {
    const booking = fixtureBooking({ startAt: "2026-08-31T13:00:00.000Z", endAt: "2026-08-31T14:00:00.000Z" });
    const segments = buildAgendaSegments("2026-08-31", "America/Sao_Paulo", closeWeekWithMonday(), [booking], [], 30);
    const collapsed = collapseAdjacentSegments(segments);
    const bookedCollapsed = collapsed.filter((segment) => segment.status === "booked");
    assert.equal(bookedCollapsed.length, 1, "os 2 segmentos de 30min do mesmo Booking colapsam numa única faixa");
    assert.equal(bookedCollapsed[0].startAt, "2026-08-31T13:00:00.000Z");
    assert.equal(bookedCollapsed[0].endAt, "2026-08-31T14:00:00.000Z");
  }

  console.log("Services agenda pure-function tests passed: zoned wall-clock conversion, day range UTC, day-of-week in timezone, time formatting per-resource (never the browser's), empty agenda (UI1), booking rendered at correct time (UI2), block rendered as unavailable (UI3), booking takes visual priority over an overlapping block, and adjacent-segment collapsing.");

  // ===== UI4/UI5/UI6/UI8 — provas estruturais sobre o componente real =====
  const agendaSource = read("client/src/pages/service-agenda.tsx");

  // UI4 — cancelar chama o comando real, nunca uma escrita direta.
  assert.match(agendaSource, /import \{ cancelServiceBooking, rescheduleServiceBooking \} from "@\/lib\/service-booking-commands"/, "UI4/UI5: usa os wrappers de comando reais, não uma nova implementação");
  assert.match(agendaSource, /await cancelServiceBooking\(selectedBooking\.id\)/, "UI4: cancelamento chama cancelServiceBooking com o id real do Booking");

  // UI5 — reagendamento consulta disponibilidade real antes de reagendar.
  assert.match(agendaSource, /import \{ createServiceAvailabilityBlock, deleteServiceAvailabilityBlock, getServiceAvailability/, "UI5: usa getServiceAvailability real, nunca uma segunda lógica de disponibilidade");
  assert.match(agendaSource, /await getServiceAvailability\(\{/, "UI5: consulta disponibilidade real antes de listar horários de reagendamento");
  assert.match(agendaSource, /await rescheduleServiceBooking\(selectedBooking\.id, \{ startAt: candidateStartAt \}\)/, "UI5: reagendamento chama rescheduleServiceBooking com um horário que veio da consulta real");

  // UI6 — race/conflito no reagendamento mostra erro E atualiza a lista de horários (nunca trava num candidato morto).
  const handleSlotBody = agendaSource.slice(
    agendaSource.indexOf("const handlePickRescheduleSlot"),
    agendaSource.indexOf("const openCreateBlock"),
  );
  assert.match(handleSlotBody, /catch \(error\) \{/, "UI6: erro de reagendamento é tratado explicitamente");
  assert.match(handleSlotBody, /setRescheduleError\(agendaErrorMessage\(error\)\)/, "UI6: mensagem de erro traduzida é exibida");
  assert.match(handleSlotBody, /await getServiceAvailability\(\{ serviceId: selectedBooking\.serviceId, resourceId: selectedBooking\.resourceId, rangeStartAt, rangeEndAt \}\)/, "UI6: após falha, a lista de horários é atualizada de novo (o slot que sumiu não fica mais oferecido)");

  // UI7 — navegação de data/resource recalcula o range consultado (a query de Bookings depende de selectedDate/timeZone).
  assert.match(agendaSource, /const \{ rangeStartAt, rangeEndAt \} = computeLocalDayRangeUtc\(selectedDate, timeZone\)/, "UI7: range consultado é recalculado a partir da data selecionada e do timezone real do resource");
  assert.match(agendaSource, /}, \[selectedDate, schedule, timeZone, reloadToken\]\)/, "UI7: o efeito que busca Bookings depende de selectedDate — navegar muda a query");

  // UI8 — nenhuma escrita direta no Firestore para Booking/Block: só os comandos server-side.
  assert.doesNotMatch(agendaSource, /\bsetDoc\b|\bupdateDoc\b|\bdeleteDoc\b|\baddDoc\b/, "UI8: a Agenda nunca escreve Booking/Block direto no Firestore — só via comandos server-side");
  assert.doesNotMatch(agendaSource, /from "firebase\/firestore"/, "UI8: nenhum import do SDK de escrita do Firestore nesta página");

  // PRODUCT-QA-01 — botão "Hoje" precisa usar o timezone real do resource (já calculado em `timeZone`),
  // nunca o relógio local do navegador quando um schedule real já foi carregado (§20). Regressão do bug:
  // perto da virada do dia, clicar "Hoje" mostrava o dia errado para um vendedor cujo navegador está num
  // timezone diferente do resource configurado.
  assert.match(agendaSource, /setSelectedDate\(todayDateKey\(timeZone\)\)/, "botão \"Hoje\" precisa passar o timezone do resource para todayDateKey");

  // PRODUCT-QA-02 — regressão: o efeito que carrega schedule/services/blocks precisa esperar o Firebase
  // Auth confirmar o estado inicial da sessão antes de buscar dados dependentes de uid. Sem isto, uma
  // navegação de página cheia para /servicos/agenda (ex.: um link direto, ou refresh) chega antes da sessão
  // persistida terminar de ser restaurada, e a busca falha com "UNAUTHENTICATED" para um usuário
  // genuinamente autenticado — reproduzido ao vivo neste sprint via Browser pane.
  assert.match(agendaSource, /await waitForAuthReady\(\);\s*\n\s*if \(cancelled\) return;\s*\n\s*const \[resourceSchedule, serviceList, blockList\]/, "o efeito de carga inicial da Agenda precisa esperar waitForAuthReady() antes de buscar schedule/services/blocks");

  // PRODUCT-QA-02 — regressão: o status do Atendimento no painel de detalhes do Booking precisa ser
  // traduzido (serviceWorkStatusLabel), nunca o valor cru do enum do servidor ("planned"/"in_progress"/...)
  // exposto diretamente ao vendedor.
  assert.doesNotMatch(agendaSource, /\{selectedWork\.status\}/, "o status do atendimento não pode mais ser exibido cru — precisa passar por serviceWorkStatusLabel()");
  assert.match(agendaSource, /\{serviceWorkStatusLabel\(selectedWork\.status\)\}/, "o status do atendimento precisa ser traduzido via serviceWorkStatusLabel()");

  // PRODUCT-QA-02 — regressão: "Reagendar"/"Cancelar agendamento" só podem aparecer quando o Work ligado
  // ainda está "planned" — mesma regra que o servidor já aplica (WORK_NOT_CANCELABLE/
  // BOOKING_NOT_RESCHEDULABLE quando work.status !== "planned", server/service-booking-commands.ts).
  // Antes desta correção a UI oferecia os dois botões para qualquer Booking confirmado, mesmo com o
  // atendimento já concluído/cancelado — o clique chegava a errar no servidor em vez de nunca aparecer.
  assert.match(agendaSource, /selectedBooking\.status === "confirmed" && selectedWork\?\.status === "planned"/, "Reagendar/Cancelar só podem aparecer quando o Work ligado ainda está \"planned\", igual à regra do servidor");

  // §0 — rota lazy, sem lib de calendário nova, sem recharts.
  const routerSource = read("client/src/routers/PrivateRouter.tsx");
  assert.match(routerSource, /const ServiceAgenda = lazy\(\(\) => import\("@\/pages\/service-agenda"\)\)/, "AGENDA_ROUTE_LAZY: a rota precisa ser lazy-loaded");
  assert.match(routerSource, /<Route path="\/servicos\/agenda" component=\{ServiceAgenda\} \/>/, "a rota /servicos/agenda precisa estar registrada");
  assert.doesNotMatch(agendaSource, /recharts/i, "RECHARTS_IMPORTED_IN_AGENDA deve ser NO — nenhum gráfico nesta tela");
  assert.doesNotMatch(agendaSource, /full-?calendar|react-big-calendar|daypilot|syncfusion/i, "nenhuma lib de calendário pesada foi adicionada (§0)");

  console.log("Services agenda structural tests passed: cancel/reschedule/block-create/block-delete use only the existing server-side commands (never a direct Firestore write for Booking/Block, UI8), reschedule queries real availability before offering slots (UI5) and refreshes candidates after a conflict (UI6), date navigation recomputes the queried range (UI7), the route is lazy-loaded with no calendar library and no recharts import.");

  // ===== PRODUCT-QA-01 — regressão: validUntil de Quote precisa ser fim do dia LOCAL, nunca 23:59:59 UTC
  // fixo (23:59:59Z é ~21h em São Paulo — expirava o orçamento ~3h antes do fim do dia escolhido). =====
  {
    // Mesma técnica DST-safe já validada acima para zonedWallClockToUtcInstant: 2026-08-31 23:59 em
    // São Paulo (UTC-3) é 2026-09-01T02:59:00Z, nunca 2026-08-31T23:59:59Z (que seria ~21h local).
    const endOfDaySp = zonedWallClockToUtcInstant("2026-08-31", 23 * 60 + 59, "America/Sao_Paulo");
    assert.equal(endOfDaySp.toISOString(), "2026-09-01T02:59:00.000Z", "fim do dia em São Paulo precisa cruzar para o dia seguinte em UTC, nunca ficar em 23:59:59Z");

    const workDetailSource = read("client/src/pages/service-work-detail.tsx");
    assert.doesNotMatch(workDetailSource, /new Date\(`\$\{quoteValidUntil\}T23:59:59\.000Z`\)/, "validUntil não pode mais usar um horário UTC fixo — precisa ser o fim do dia no timezone do vendedor");
    const validUntilCallCount = (workDetailSource.match(/endOfLocalDayIso\(quoteValidUntil, bookingTimeZone \|\| Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone\)/g) ?? []).length;
    assert.equal(validUntilCallCount, 2, "os dois pontos que setam validUntil (criar orçamento e salvar rascunho) precisam usar endOfLocalDayIso com o timezone real");

    // PRODUCT-QA-02 — regressão: o efeito que carrega o Work (+ Booking ligado) precisa esperar
    // waitForAuthReady() antes de chamar getServiceWork()/listServiceBookingsForWork() — reproduzido ao
    // vivo neste sprint: o link "Ver atendimento completo" da Agenda é um <a href> (navegação de página
    // cheia), e chegar aqui antes da sessão persistida terminar de restaurar fazia requireCurrentUid()
    // lançar "UNAUTHENTICATED", mostrando "Sessão inválida. Faça login novamente." para um usuário
    // genuinamente autenticado.
    assert.match(
      workDetailSource,
      /await waitForAuthReady\(\);\s*\n\s*if \(cancelled\) return;\s*\n\s*const \[loadedWork, relatedBookings\]/,
      "o efeito que carrega o Work precisa esperar waitForAuthReady() antes de buscar dados dependentes de uid",
    );
  }
}

function closeWeekWithMonday(): WeeklyHours {
  return { ...closedWeek(), monday: [{ start: "08:00", end: "12:00" }, { start: "13:00", end: "18:00" }] };
}

run();
