import { useRef, useState } from "react";
import { ChevronDown, ImagePlus, X } from "lucide-react";
import { apiRequest } from "@/lib/api-client";
import { getFirebaseAuth } from "@/lib/firebase";
import { notifyError, notifySuccess } from "@/lib/notify";
import { ServerUploadError, uploadImageViaServer } from "@/lib/server-upload";
import { DEFAULT_NUMBER_COUNT, DEFAULT_NUMBER_START, MAX_CAMPAIGN_NUMBERS } from "@shared/promotional-campaigns";

/**
 * PROMOTIONAL-CAMPAIGNS-01B §3/§4/§6/§7 — formulário completo de criação, em chunk PRÓPRIO (lazy),
 * carregado só quando o admin clica "Criar campanha" — a listagem (sorteios-admin.tsx) nunca paga o
 * custo deste código. Expõe todos os campos do MVP (nenhum escondido para economizar bundle); os menos
 * usados ficam numa seção "Configurações avançadas" colapsável, não removidos.
 */
const FIELD_CLASS = "rs-input flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground";

/** PROMOTIONAL-CAMPAIGNS-HOTFIX-01 — mensagens amigáveis por `reason` real do servidor
 * (`shared/image-validation.ts`), em vez de repassar o código técnico cru (`UPLOAD_REJECTED: ...`)
 * pro usuário. A causa real ainda vai pro console (`console.error`) para depuração. */
const UPLOAD_ERROR_MESSAGES: Record<string, string> = {
  empty: "Selecione uma imagem válida.",
  "too-large": "A imagem é muito grande (máx. 5MB).",
  "unsupported-format": "Formato não suportado. Use JPEG, PNG ou WebP.",
  "mime-mismatch": "Não foi possível identificar o formato da imagem. Tente outra foto.",
  "corrupt-or-truncated": "A imagem parece corrompida. Tente outra foto.",
  "invalid-dimensions": "Essa imagem não é válida.",
  "megapixels-exceeded": "A imagem tem resolução muito alta.",
};

interface FormState {
  title: string; description: string; prizeName: string; prizeImageUrl: string;
  startsAt: string; endsAt: string; drawAt: string;
  spendPerEntry: string; numberCount: string;
}
const EMPTY: FormState = {
  title: "", description: "", prizeName: "", prizeImageUrl: "",
  startsAt: "", endsAt: "", drawAt: "", spendPerEntry: "100", numberCount: String(DEFAULT_NUMBER_COUNT),
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{label}</span>{children}</label>;
}

export default function SorteiosCreate({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const uploadTargetId = useRef(crypto.randomUUID());

  const set = (field: keyof FormState) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [field]: event.target.value }));

  const handleImagePick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const token = await getFirebaseAuth()?.currentUser?.getIdToken();
      if (!token) throw new Error("Sessão inválida.");
      const result = await uploadImageViaServer({ kind: "campaign-prize", targetId: uploadTargetId.current, blob: file, token });
      setForm((prev) => ({ ...prev, prizeImageUrl: result.downloadUrl }));
    } catch (error) {
      if (error instanceof ServerUploadError) {
        console.error("[sorteios-create] falha no upload da imagem do prêmio", { code: error.code, reason: error.reason });
        notifyError((error.reason && UPLOAD_ERROR_MESSAGES[error.reason]) || "Não foi possível enviar a imagem. Tente novamente.");
      } else {
        console.error("[sorteios-create] falha inesperada no upload da imagem do prêmio", error);
        notifyError("Não foi possível enviar a imagem. Verifique sua conexão e tente novamente.");
      }
    } finally {
      setUploading(false);
    }
  };

  const numberCount = Number(form.numberCount);
  const rangeValid = Number.isInteger(numberCount) && numberCount > 0 && numberCount <= MAX_CAMPAIGN_NUMBERS;

  const handleSubmit = async () => {
    if (!form.title.trim() || !form.prizeName.trim() || !form.startsAt || !form.endsAt) {
      notifyError("Preencha nome da campanha, prêmio e as datas.");
      return;
    }
    if (!rangeValid) {
      notifyError(`Quantidade de números precisa ser um inteiro entre 1 e ${MAX_CAMPAIGN_NUMBERS}.`);
      return;
    }
    if (!(Number(form.spendPerEntry) > 0)) {
      notifyError("Valor por participação precisa ser maior que zero.");
      return;
    }
    setSaving(true);
    try {
      await apiRequest("/api/admin/sorteios/campaigns", {
        auth: true,
        method: "POST",
        body: {
          title: form.title.trim(),
          description: form.description.trim(),
          prizeName: form.prizeName.trim(),
          prizeImageUrl: form.prizeImageUrl || null,
          startsAt: new Date(form.startsAt).toISOString(),
          endsAt: new Date(form.endsAt).toISOString(),
          drawAt: form.drawAt ? new Date(form.drawAt).toISOString() : null,
          spendPerEntry: Number(form.spendPerEntry),
          numberCount,
          allocationMode: "customer_choice",
        },
      });
      notifySuccess("Campanha criada como rascunho.");
      onCreated();
      onClose();
    } catch (error) {
      notifyError(error instanceof Error ? error.message : "Não foi possível criar a campanha.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-card p-5 shadow-2xl sm:rounded-3xl" onClick={(event) => event.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-black text-foreground">Criar campanha</h2>
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded-full p-1.5 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-3">
          <Field label="Nome da campanha"><input placeholder="Sorteio Malbec EDP" value={form.title} onChange={set("title")} className={FIELD_CLASS} /></Field>
          <Field label="Descrição"><textarea value={form.description} onChange={set("description")} className={`${FIELD_CLASS} min-h-16 py-2`} placeholder="Campanha promocional de clientes" /></Field>
          <Field label="Prêmio"><input placeholder="Garrafa de vinho Malbec" value={form.prizeName} onChange={set("prizeName")} className={FIELD_CLASS} /></Field>

          <Field label="Imagem do prêmio">
            <label className="flex h-24 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-input text-xs font-bold text-muted-foreground">
              {form.prizeImageUrl
                ? <img src={form.prizeImageUrl} alt="Prêmio" className="h-full rounded-xl object-cover" />
                : <span className="flex items-center gap-1.5"><ImagePlus className="h-4 w-4" /> {uploading ? "Enviando…" : "Selecionar imagem"}</span>}
              <input type="file" accept="image/*" onChange={handleImagePick} disabled={uploading} className="hidden" data-testid="input-prize-image" />
            </label>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Data inicial"><input type="date" value={form.startsAt} onChange={set("startsAt")} className={FIELD_CLASS} /></Field>
            <Field label="Data final"><input type="date" value={form.endsAt} onChange={set("endsAt")} className={FIELD_CLASS} /></Field>
          </div>

          <button type="button" onClick={() => setAdvancedOpen((v) => !v)} className="flex w-full items-center justify-between text-xs font-bold text-primary" data-testid="button-toggle-advanced">
            Configurações avançadas <ChevronDown className={`h-4 w-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
          </button>

          {advancedOpen && (
            <div className="space-y-3 rounded-xl bg-secondary/40 p-3">
              <Field label="Data prevista da apuração (opcional)"><input type="date" value={form.drawAt} onChange={set("drawAt")} className={FIELD_CLASS} /></Field>
              <Field label="Valor necessário por participação (R$)"><input type="number" min="1" value={form.spendPerEntry} onChange={set("spendPerEntry")} className={FIELD_CLASS} /></Field>
              <Field label="Quantidade de números"><input type="number" min="1" max={MAX_CAMPAIGN_NUMBERS} step="1" value={form.numberCount} onChange={set("numberCount")} className={FIELD_CLASS} /></Field>
              <p className="text-[11px] text-muted-foreground" data-testid="text-range-preview">
                {rangeValid
                  ? `${numberCount} números — Faixa: ${String(DEFAULT_NUMBER_START).padStart(2, "0")} a ${DEFAULT_NUMBER_START + numberCount - 1}`
                  : `Quantidade de números precisa ser um inteiro entre 1 e ${MAX_CAMPAIGN_NUMBERS}.`}
              </p>
            </div>
          )}
        </div>

        <button type="button" onClick={handleSubmit} disabled={saving || uploading} className="mt-5 flex w-full items-center justify-center rounded-full bg-primary py-3 text-sm font-black text-white disabled:opacity-60">
          {saving ? "Criando…" : "Criar campanha"}
        </button>
      </div>
    </div>
  );
}
