import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Layout } from "@/components/layout";
import { PageSkeleton } from "@/components/PageSkeleton";
import { EmptyState } from "@/components/EmptyState";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getServiceResourceSchedule, listServiceAvailabilityBlocksForResource } from "@/lib/service-availability-persistence";
import { createServiceAvailabilityBlock, deleteServiceAvailabilityBlock, upsertServiceResourceSchedule } from "@/lib/service-availability-commands";
import { notifyError, notifySuccess } from "@/lib/notify";
import {
  addDaysToDateKey,
  agendaErrorMessage,
  DAY_LABELS,
  DISPLAY_DAYS,
  draftFromWeeklyHours,
  emptyWeeklyDraft,
  formatTimeInTimezone,
  todayDateKey,
  validateWeeklyDraft,
  weeklyHoursFromDraft,
  zonedWallClockToUtcInstant,
  type WeeklyDraft,
} from "@/lib/service-agenda-helpers";
import type { ServiceAvailabilityBlock, ServiceResourceSchedule } from "@shared/service-availability";

/**
 * SERV-UI-02 — configuração de disponibilidade: linguagem amigável na UI (nunca "weeklyHours"/
 * "slotStepMinutes"/"resourceId"), mas o shape enviado ao servidor é exatamente o que
 * upsertServiceResourceSchedule já espera (client/src/lib/service-availability-commands.ts, SERV-AVAIL-01)
 * — nenhuma lógica de disponibilidade paralela aqui, o servidor continua a autoridade final.
 */
const DEFAULT_RESOURCE_ID = "default";
const browserTimeZone = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";

const MIN_ADVANCE_OPTIONS: readonly { label: string; minutes: number }[] = [
  { label: "Sem antecedência mínima", minutes: 0 },
  { label: "30 minutos", minutes: 30 },
  { label: "1 hora", minutes: 60 },
  { label: "2 horas", minutes: 120 },
  { label: "4 horas", minutes: 240 },
  { label: "12 horas", minutes: 720 },
  { label: "24 horas", minutes: 1440 },
];
const MAX_ADVANCE_OPTIONS: readonly { label: string; days: number | undefined }[] = [
  { label: "Sem limite definido", days: undefined },
  { label: "7 dias", days: 7 },
  { label: "15 dias", days: 15 },
  { label: "30 dias", days: 30 },
  { label: "60 dias", days: 60 },
  { label: "90 dias", days: 90 },
];

export default function ServiceAvailabilitySettings() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [hadSchedule, setHadSchedule] = useState(false);
  const [timezone, setTimezone] = useState(browserTimeZone);
  const [slotStepMinutes, setSlotStepMinutes] = useState(30);
  const [minAdvanceMinutes, setMinAdvanceMinutes] = useState(0);
  const [maxAdvanceDays, setMaxAdvanceDays] = useState<number | undefined>(undefined);
  const [weeklyDraft, setWeeklyDraft] = useState<WeeklyDraft>(() => emptyWeeklyDraft());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [blocks, setBlocks] = useState<ServiceAvailabilityBlock[]>([]);
  const [blockDialogOpen, setBlockDialogOpen] = useState(false);
  const [blockDate, setBlockDate] = useState(() => todayDateKey());
  const [blockStart, setBlockStart] = useState("09:00");
  const [blockEnd, setBlockEnd] = useState("10:00");
  const [blockFullDay, setBlockFullDay] = useState(false);
  const [blockReason, setBlockReason] = useState("");
  const [creatingBlock, setCreatingBlock] = useState(false);
  const [blockError, setBlockError] = useState("");
  const [deletingBlockId, setDeletingBlockId] = useState<string | null>(null);
  const [deletingBlock, setDeletingBlock] = useState(false);

  const markDirty = useCallback(() => setDirty(true), []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [schedule, blockList] = await Promise.all([
        getServiceResourceSchedule(DEFAULT_RESOURCE_ID),
        listServiceAvailabilityBlocksForResource(DEFAULT_RESOURCE_ID),
      ]);
      applySchedule(schedule);
      setBlocks(blockList);
      setDirty(false);
    } catch (error) {
      setLoadError(agendaErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  function applySchedule(schedule: ServiceResourceSchedule | null) {
    if (schedule) {
      setHadSchedule(true);
      setTimezone(schedule.timezone);
      setSlotStepMinutes(schedule.slotStepMinutes);
      setMinAdvanceMinutes(schedule.minAdvanceMinutes);
      setMaxAdvanceDays(schedule.maxAdvanceDays);
      setWeeklyDraft(draftFromWeeklyHours(schedule.weeklyHours));
    } else {
      // §12 — sem schedule ainda: sugere o timezone do navegador, mas nunca salva sozinho — o usuário
      // precisa confirmar clicando em "Salvar horários".
      setHadSchedule(false);
      setTimezone(browserTimeZone);
      setSlotStepMinutes(30);
      setMinAdvanceMinutes(0);
      setMaxAdvanceDays(undefined);
      setWeeklyDraft(emptyWeeklyDraft());
    }
  }

  useEffect(() => { load(); }, [load]);

  const upcomingBlocks = useMemo(
    () => blocks
      .filter((block) => Date.parse(block.endAt) >= Date.now())
      .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt)),
    [blocks],
  );

  const addPeriod = useCallback((day: keyof WeeklyDraft) => {
    setWeeklyDraft((current) => ({
      ...current,
      [day]: [...current[day], { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, start: "09:00", end: "18:00" }],
    }));
    markDirty();
  }, [markDirty]);

  const removePeriod = useCallback((day: keyof WeeklyDraft, id: string) => {
    setWeeklyDraft((current) => ({ ...current, [day]: current[day].filter((period) => period.id !== id) }));
    markDirty();
  }, [markDirty]);

  const updatePeriod = useCallback((day: keyof WeeklyDraft, id: string, field: "start" | "end", value: string) => {
    setWeeklyDraft((current) => ({
      ...current,
      [day]: current[day].map((period) => period.id === id ? { ...period, [field]: value } : period),
    }));
    markDirty();
  }, [markDirty]);

  const handleSave = useCallback(async () => {
    const overlapMessage = validateWeeklyDraft(weeklyDraft);
    if (overlapMessage) {
      setFormError(overlapMessage);
      return;
    }
    setFormError("");
    setSaving(true);
    try {
      await upsertServiceResourceSchedule(DEFAULT_RESOURCE_ID, {
        timezone, slotStepMinutes, minAdvanceMinutes, maxAdvanceDays, weeklyHours: weeklyHoursFromDraft(weeklyDraft),
      });
      notifySuccess("Horários salvos.");
      setDirty(false);
      await load();
    } catch (error) {
      setFormError(agendaErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }, [timezone, slotStepMinutes, minAdvanceMinutes, maxAdvanceDays, weeklyDraft, load]);

  const openCreateBlock = useCallback(() => {
    setBlockDate(todayDateKey());
    setBlockStart("09:00");
    setBlockEnd("10:00");
    setBlockFullDay(false);
    setBlockReason("");
    setBlockError("");
    setBlockDialogOpen(true);
  }, []);

  const handleCreateBlock = useCallback(async () => {
    setCreatingBlock(true);
    setBlockError("");
    try {
      let startAt: string;
      let endAt: string;
      if (blockFullDay) {
        startAt = zonedWallClockToUtcInstant(blockDate, 0, timezone).toISOString();
        endAt = zonedWallClockToUtcInstant(addDaysToDateKey(blockDate, 1), 0, timezone).toISOString();
      } else {
        const [startHour, startMinute] = blockStart.split(":").map(Number);
        const [endHour, endMinute] = blockEnd.split(":").map(Number);
        startAt = zonedWallClockToUtcInstant(blockDate, startHour * 60 + startMinute, timezone).toISOString();
        endAt = zonedWallClockToUtcInstant(blockDate, endHour * 60 + endMinute, timezone).toISOString();
      }
      await createServiceAvailabilityBlock({ resourceId: DEFAULT_RESOURCE_ID, startAt, endAt, reason: blockReason || undefined });
      notifySuccess("Bloqueio adicionado.");
      setBlockDialogOpen(false);
      const blockList = await listServiceAvailabilityBlocksForResource(DEFAULT_RESOURCE_ID);
      setBlocks(blockList);
    } catch (error) {
      setBlockError(agendaErrorMessage(error));
    } finally {
      setCreatingBlock(false);
    }
  }, [blockDate, blockStart, blockEnd, blockFullDay, blockReason, timezone]);

  const handleDeleteBlock = useCallback(async () => {
    if (!deletingBlockId) return;
    setDeletingBlock(true);
    try {
      await deleteServiceAvailabilityBlock(deletingBlockId);
      notifySuccess("Bloqueio removido.");
      setBlocks((current) => current.filter((block) => block.id !== deletingBlockId));
      setDeletingBlockId(null);
    } catch (error) {
      notifyError(agendaErrorMessage(error));
    } finally {
      setDeletingBlock(false);
    }
  }, [deletingBlockId]);

  if (loading) {
    return <Layout title="Disponibilidade"><div className="mx-auto max-w-3xl px-4 py-4"><PageSkeleton variant="cards" /></div></Layout>;
  }
  if (loadError) {
    return <Layout title="Disponibilidade"><div className="mx-auto max-w-3xl px-4 py-8"><EmptyState title="Não foi possível carregar" description={loadError} action={<Button onClick={load} className="rounded-full">Tentar novamente</Button>} /></div></Layout>;
  }

  return (
    <Layout title="Disponibilidade">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-4 pb-28">
        {!hadSchedule && (
          <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800" data-testid="banner-no-schedule">
            Você ainda não configurou horários de atendimento. Preencha abaixo e salve para ativar a Agenda.
          </div>
        )}

        <section className="space-y-3 rounded-3xl bg-white p-4 shadow-sm">
          <h2 className="text-sm font-black text-foreground">Horários de atendimento</h2>
          {DISPLAY_DAYS.map((day) => {
            const periods = weeklyDraft[day];
            const active = periods.length > 0;
            return (
              <div key={day} className="rounded-2xl border border-border/60 p-3" data-testid={`day-card-${day}`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black uppercase text-foreground">{DAY_LABELS[day]}</span>
                  <span className={`text-[10px] font-bold ${active ? "text-emerald-600" : "text-muted-foreground"}`} data-testid={`day-status-${day}`}>
                    {active ? "Ativo" : "Fechado"}
                  </span>
                </div>
                <div className="mt-2 space-y-2">
                  {periods.map((period) => (
                    <div key={period.id} className="flex items-center gap-2">
                      <Input type="time" value={period.start} onChange={(event) => updatePeriod(day, period.id, "start", event.target.value)} data-testid={`period-start-${period.id}`} className="h-10" />
                      <span className="text-xs text-muted-foreground">até</span>
                      <Input type="time" value={period.end} onChange={(event) => updatePeriod(day, period.id, "end", event.target.value)} data-testid={`period-end-${period.id}`} className="h-10" />
                      <button type="button" onClick={() => removePeriod(day, period.id)} aria-label="Remover período" data-testid={`button-remove-period-${period.id}`} className="rs-icon-press flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-red-600">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
                <button type="button" onClick={() => addPeriod(day)} data-testid={`button-add-period-${day}`} className="rs-pressable mt-2 flex items-center gap-1 text-xs font-bold text-primary">
                  <Plus className="h-3.5 w-3.5" /> Adicionar período
                </button>
              </div>
            );
          })}
        </section>

        <section className="space-y-4 rounded-3xl bg-white p-4 shadow-sm">
          <h2 className="text-sm font-black text-foreground">Regras de agendamento</h2>
          <div>
            <Label>Fuso horário</Label>
            <Input value={timezone} onChange={(event) => { setTimezone(event.target.value); markDirty(); }} data-testid="input-timezone" />
          </div>
          {/* SERV-UI-02 — <select> nativo em vez de @radix-ui/react-select: o Radix Select nunca era usado
              em nenhuma outra tela deste app (confirmado por auditoria), então usá-lo aqui puxaria ~19kB
              de vendor-radix pela primeira vez — orçamento de bundle não pode subir de novo neste ticket
              (§0/§26). Comportamento equivalente, custo zero de dependência nova. */}
          <div>
            <Label htmlFor="select-slot-step">Intervalo entre opções de horário</Label>
            <select id="select-slot-step" data-testid="select-slot-step" value={slotStepMinutes} onChange={(event) => { setSlotStepMinutes(Number(event.target.value)); markDirty(); }} className="rs-input flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
              <option value={15}>15 minutos</option>
              <option value={30}>30 minutos</option>
            </select>
          </div>
          <div>
            <Label htmlFor="select-min-advance">Com quanto tempo de antecedência o cliente pode agendar?</Label>
            <select id="select-min-advance" data-testid="select-min-advance" value={minAdvanceMinutes} onChange={(event) => { setMinAdvanceMinutes(Number(event.target.value)); markDirty(); }} className="rs-input flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
              {MIN_ADVANCE_OPTIONS.map((option) => <option key={option.minutes} value={option.minutes}>{option.label}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="select-max-advance">Até quantos dias no futuro podem ser feitos agendamentos?</Label>
            <select id="select-max-advance" data-testid="select-max-advance" value={maxAdvanceDays === undefined ? "none" : maxAdvanceDays} onChange={(event) => { setMaxAdvanceDays(event.target.value === "none" ? undefined : Number(event.target.value)); markDirty(); }} className="rs-input flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
              {MAX_ADVANCE_OPTIONS.map((option) => <option key={option.label} value={option.days === undefined ? "none" : option.days}>{option.label}</option>)}
            </select>
          </div>
        </section>

        {formError && <p className="text-sm font-semibold text-red-600" data-testid="text-schedule-error">{formError}</p>}
        <Button type="button" onClick={handleSave} disabled={!dirty || saving} data-testid="button-save-schedule" className="w-full rounded-full">
          {saving ? "Salvando…" : "Salvar horários"}
        </Button>

        <section className="space-y-3 rounded-3xl bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-black text-foreground">Folgas e bloqueios</h2>
            <Button type="button" variant="outline" size="sm" onClick={openCreateBlock} data-testid="button-add-block" className="rounded-full">
              <Plus className="mr-1 h-4 w-4" /> Adicionar bloqueio
            </Button>
          </div>
          {upcomingBlocks.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-blocks">Nenhuma folga ou bloqueio nos próximos dias.</p>
          ) : (
            <ul className="space-y-2" data-testid="list-blocks">
              {upcomingBlocks.map((block) => (
                <li key={block.id} className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 p-3" data-testid={`block-item-${block.id}`}>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-foreground">{formatTimeInTimezone(block.startAt, timezone)} – {formatTimeInTimezone(block.endAt, timezone)}</p>
                    <p className="truncate text-xs text-muted-foreground">{block.reason || "Sem motivo informado"}</p>
                  </div>
                  <button type="button" onClick={() => setDeletingBlockId(block.id)} data-testid={`button-remove-block-${block.id}`} className="rs-pressable shrink-0 text-xs font-bold text-red-600">Remover</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <Dialog open={blockDialogOpen} onOpenChange={setBlockDialogOpen}>
        <DialogContent className="max-w-sm rounded-[2rem]" data-testid="dialog-create-block">
          <DialogHeader>
            <DialogTitle>Adicionar bloqueio</DialogTitle>
            <DialogDescription>Ex.: consulta médica, férias, reunião, compromisso pessoal.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="block-date">Data</Label>
              <Input id="block-date" type="date" value={blockDate} onChange={(event) => setBlockDate(event.target.value)} data-testid="input-block-date" />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={blockFullDay} onChange={(event) => setBlockFullDay(event.target.checked)} data-testid="checkbox-block-full-day" />
              Dia inteiro
            </label>
            {!blockFullDay && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="block-start">Início</Label>
                  <Input id="block-start" type="time" value={blockStart} onChange={(event) => setBlockStart(event.target.value)} data-testid="input-block-start" />
                </div>
                <div>
                  <Label htmlFor="block-end">Fim</Label>
                  <Input id="block-end" type="time" value={blockEnd} onChange={(event) => setBlockEnd(event.target.value)} data-testid="input-block-end" />
                </div>
              </div>
            )}
            <div>
              <Label htmlFor="block-reason">Motivo (opcional)</Label>
              <Input id="block-reason" value={blockReason} onChange={(event) => setBlockReason(event.target.value)} placeholder="Ex.: consulta médica" data-testid="input-block-reason" />
            </div>
            {blockError && <p className="text-sm font-semibold text-red-600" data-testid="text-block-error">{blockError}</p>}
          </div>
          <DialogFooter>
            <Button type="button" onClick={handleCreateBlock} disabled={creatingBlock} data-testid="button-confirm-create-block" className="w-full rounded-full">
              {creatingBlock ? "Adicionando…" : "Adicionar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmActionDialog
        open={Boolean(deletingBlockId)}
        onOpenChange={(open) => { if (!open) setDeletingBlockId(null); }}
        title="Remover bloqueio?"
        description="O horário voltará a ficar disponível imediatamente."
        confirmLabel="Remover bloqueio"
        onConfirm={handleDeleteBlock}
        disabled={deletingBlock}
      />
    </Layout>
  );
}
