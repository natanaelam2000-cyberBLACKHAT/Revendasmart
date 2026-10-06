import { Download, FolderOpen, Plus, Save, Share2 } from "lucide-react";
import type { AdsProAdDocumentV1 } from "@shared/ads-pro/ad-document";
import { StudioBanner, StudioPrimaryButton } from "./StudioPrimitives";

export type StudioBusy = "idle" | "saving" | "downloading" | "sharing";

export interface StudioFeedback {
  readonly tone: "info" | "success" | "warning" | "error";
  readonly text: string;
  readonly kind: "save" | "download" | "share" | "export";
}

export interface StudioSavedProject {
  readonly id: string;
  readonly title: string;
  readonly dateLabel: string;
  readonly imageUrl?: string;
  readonly format: AdsProAdDocumentV1["format"];
}

export function StudioSaveStep({
  canExport,
  exportBlockedReason,
  size,
  unsaved,
  hasSaved,
  busy,
  feedback,
  projects,
  onSave,
  onDownload,
  onShare,
  onNewProject,
  onOpenProject,
}: {
  readonly canExport: boolean;
  readonly exportBlockedReason: string | null;
  readonly size: { readonly width: number; readonly height: number };
  readonly unsaved: boolean;
  readonly hasSaved: boolean;
  readonly busy: StudioBusy;
  readonly feedback: StudioFeedback | null;
  readonly projects: readonly StudioSavedProject[];
  readonly onSave: () => void;
  readonly onDownload: () => void;
  readonly onShare: () => void;
  readonly onNewProject: () => void;
  readonly onOpenProject: (id: string) => void;
}) {
  const working = busy !== "idle";
  return (
    <div className="space-y-4" data-testid="studio-step-save">
      <div className="rounded-xl border border-border/60 bg-background px-3 py-2" data-testid="studio-export-summary">
        <p className="text-xs font-black text-foreground">PNG {size.width}×{size.height} px</p>
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground" data-testid="studio-save-state" data-unsaved={unsaved}>
          {unsaved ? (hasSaved ? "Há alterações ainda não salvas." : "Ainda não salvo no histórico.") : "Tudo salvo no histórico."}
        </p>
      </div>

      {exportBlockedReason && <StudioBanner tone="warning" testId="studio-export-blocked">{exportBlockedReason}</StudioBanner>}

      <div className="space-y-2">
        <StudioPrimaryButton onClick={onSave} disabled={!canExport || working} busy={busy === "saving"} testId="studio-save">
          <Save className="h-4 w-4" aria-hidden="true" /> {busy === "saving" ? "Salvando..." : hasSaved ? "Salvar alterações" : "Salvar no histórico"}
        </StudioPrimaryButton>
        <div className="grid grid-cols-2 gap-2">
          <StudioPrimaryButton tone="outline" onClick={onDownload} disabled={!canExport || working} busy={busy === "downloading"} testId="studio-download">
            <Download className="h-4 w-4" aria-hidden="true" /> {busy === "downloading" ? "Gerando..." : "Baixar PNG"}
          </StudioPrimaryButton>
          <StudioPrimaryButton tone="outline" onClick={onShare} disabled={!canExport || working} busy={busy === "sharing"} testId="studio-share">
            <Share2 className="h-4 w-4" aria-hidden="true" /> {busy === "sharing" ? "Abrindo..." : "Compartilhar"}
          </StudioPrimaryButton>
        </div>
      </div>

      {feedback && <StudioBanner tone={feedback.tone} testId={`studio-feedback-${feedback.kind}`}>{feedback.text}</StudioBanner>}
      <p className="text-[10px] leading-snug text-muted-foreground">
        Montar, trocar de fundo, editar, salvar, baixar e compartilhar não usam créditos — tudo acontece no seu aparelho.
      </p>

      <StudioPrimaryButton tone="outline" onClick={onNewProject} disabled={working} testId="studio-new-project"><Plus className="h-4 w-4" aria-hidden="true" /> Novo anúncio</StudioPrimaryButton>

      {projects.length > 0 && (
        <section aria-labelledby="studio-projects-title" className="space-y-2" data-testid="studio-projects">
          <h3 id="studio-projects-title" className="text-xs font-black text-foreground">Anúncios salvos para continuar editando</h3>
          <ul className="space-y-2">
            {projects.map((project) => (
              <li key={project.id} className="flex items-center gap-3 rounded-xl border border-border/60 bg-background p-2">
                <span className="h-14 w-11 shrink-0 overflow-hidden rounded-lg bg-muted">
                  {project.imageUrl && <img src={project.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-black text-foreground">{project.title}</span>
                  <span className="block text-[10px] font-semibold text-muted-foreground">{project.dateLabel}</span>
                </span>
                <button
                  type="button"
                  onClick={() => onOpenProject(project.id)}
                  disabled={working}
                  className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-primary/30 bg-white px-3 text-xs font-black text-primary disabled:opacity-50"
                  data-testid={`studio-open-project-${project.id}`}
                >
                  <FolderOpen className="h-4 w-4" aria-hidden="true" /> Reabrir
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
