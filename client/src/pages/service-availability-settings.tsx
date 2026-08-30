import { Layout } from "@/components/layout";
import { EmptyState } from "@/components/EmptyState";
import { Settings } from "lucide-react";

/**
 * SERV-UI-01 §14 — placeholder mínimo só para a Agenda ter um destino de navegação real (CTA "Configurar
 * horários"). A configuração completa de expediente/pausas/folgas (upsertServiceResourceSchedule já existe
 * no backend desde SERV-AVAIL-01) é escopo de SERV-UI-02 — não construída aqui.
 */
export default function ServiceAvailabilitySettings() {
  return (
    <Layout title="Disponibilidade">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <EmptyState
          icon={<Settings className="h-12 w-12 text-muted-foreground/30" />}
          title="Configuração de horários em breve"
          description="A tela completa para configurar expediente, pausas e folgas ainda está em construção."
        />
      </div>
    </Layout>
  );
}
