# RS-SERVICOS-01 — Resultado de Execução (Claude Code, sessão cloud)

Data: 2026-09-25
Agente: Claude Code (sessão cloud/remota)

## Branch / HEAD

- Branch: `work/rs-servicos-01-cloud` (correta — a sessão anterior nesta mesma data estava em `chore/shared-ai-context-cloud`, descendente de `origin/main`, que não contém a feature de Serviços)
- HEAD inicial: `924d484945fb865b7fe33733ed8e8b90765c7aea` (ancestral: `f247a9c` ADS-PRO-03E2, que já contém toda a feature de Serviços/D1/D2)
- HEAD final: ver commit abaixo
- Working tree antes de começar: limpo

## Commit

Um commit local nesta branch (ver hash no log após push). Nenhum outro commit criado.

## Arquivos alterados

- `script/services-agenda-ui-tests.ts` — asserção estrutural desatualizada corrigida (ver abaixo)
- `script/plan-impl-02a-limits-tests.ts` — asserções estruturais desatualizadas corrigidas (ver abaixo)
- `.ai-context/RESULTS/RS-SERVICOS-01-claude-code.md` (este relatório)

## Estado encontrado (preflight real)

A branch `work/rs-servicos-01-cloud` parte de `f247a9c` (ADS-PRO-03E2), que **já contém toda a feature de Serviços**: `client/src/pages/services-new.tsx`, `services-list.tsx`, `service-agenda.tsx`, `service-availability-settings.tsx`, `service-work-detail.tsx`, `service-works-list.tsx`, `public-service-booking.tsx`, `public-service-booking-manage.tsx`; `client/src/lib/services-persistence.ts` e toda a família `service-*-commands.ts`/`*-persistence.ts`; `server/service-*-commands.ts` e `server/service-public-booking.ts`; `shared/services.ts`, `shared/service-bookings.ts`, `shared/service-availability.ts`, `shared/service-quotes.ts`, `shared/service-contact.ts`. D1 e D2 estão **explicitamente identificados no código** (comentários `// D1:` e `// D2 — decisão de produto:` em `server/service-booking-commands.ts`, função `confirmServiceBookingHoldCommand`): confirmação pública nunca cria/associa Client automaticamente; o contato fica só como snapshot histórico.

`npm ci` foi necessário (node_modules não estava instalado no container). `npm run check` (tsc) passou limpo sem alterações.

## Implementação realizada

Nenhuma funcionalidade nova foi implementada — a auditoria completa (ver "Testes" abaixo) não encontrou nenhuma lacuna funcional real nos 10 critérios do BRIEF. O trabalho desta sessão foi **investigativo e de correção de testes desatualizados** (nunca de comportamento):

1. **`script/services-agenda-ui-tests.ts`** — a asserção UI4/UI5 exigia a linha exata `import { cancelServiceBooking, rescheduleServiceBooking } from "@/lib/service-booking-commands"`. O import real (linha 19 de `service-agenda.tsx`) foi legitimamente ampliado por trabalho posterior (`associateServiceBookingCustomer`, `createClientFromServiceBookingCommand` — feature D2 de associação explícita de cliente) para `import { associateServiceBookingCustomer, cancelServiceBooking, createClientFromServiceBooking, rescheduleServiceBooking } from "@/lib/service-booking-commands"`. A funcionalidade em si (chamadas reais a `cancelServiceBooking`/`rescheduleServiceBooking`) já estava correta e testada por outras asserções da mesma suíte. Corrigido o regex para aceitar qualquer conjunto de imports nomeados dessa mesma linha, desde que contenha `cancelServiceBooking` e `rescheduleServiceBooking` — sem enfraquecer a garantia original.

2. **`script/plan-impl-02a-limits-tests.ts`** — bloco de asserções (RC-P0-CLIENT-LIMIT-01) descrevia uma arquitetura **anterior** a D1/D2: esperava que `confirmServiceBookingHoldCommand` chamasse `createClientInTransaction` e engolisse `PLAN_LIMIT_REACHED`. D1/D2 (posteriores, corretos, e comprovadamente em produção no código) substituíram esse design por uma garantia **mais forte**: a confirmação nunca cria nem associa Client — o contato fica só como snapshot imutável, então nenhuma verificação de cota de Client roda nesse caminho. As asserções antigas quebravam porque: (a) buscavam `CLIENT_LIMIT_REACHED` em todo o arquivo, incluindo a nova função legítima `createClientFromServiceBookingCommand` (ação explícita e autenticada do dono, testada à parte em `service-booking-contact-tests.ts`); (b) exigiam uma chamada a `createClientInTransaction` dentro de `confirmServiceBookingHoldCommand` que não existe mais, por desenho. Reescrevi o bloco para: escopar as asserções ao corpo real de `confirmServiceBookingHoldCommand`; assegurar que essa função nunca cria/associa Client (`doesNotMatch createClientInTransaction`); assegurar que o contato é persistido via `assertValidBookingContactSnapshot` (D1); manter a asserção de que `clientCountSnap` não existe em lugar nenhum do arquivo. A garantia de produto (nunca abortar uma reserva pública por causa de cota de Client) permanece verificada — apenas mais estritamente, batendo com o código real.

Ambas as correções seguem a regra do CLAUDE.md para `script/smoke-tests.ts` (aplicada aqui pelo mesmo princípio): quando uma mudança correta e já implementada quebra uma asserção de texto-fonte, a asserção é atualizada para bater com a implementação real — nunca enfraquecendo a garantia que ela protege.

## Testes

### Gates de projeto
- `npm run check` (tsc): PASS, sem erros.
- `npm run lint` (arquivos configurados no `package.json`): PASS — 0 erros, 1 warning pré-existente em `client/src/pages/settings.tsx` (arquivo não tocado nesta sessão).
- `npm run build`: PASS.
- `npm run performance:bundle-check`: **PASS** (orçamento JS de 2265 kB preservado, não alterado).
- `npm test` (cadeia padrão do projeto): passa até `script/lgpd-anpd-remediation-01-tests.ts`, onde há uma falha **pré-existente e fora de escopo** (`buildPublicCatalogStore` / Pix key em `shared/public-catalog.ts` — nada relacionado a Serviços, D1/D2 ou Somente Serviços; arquivo não tocado nesta sessão; confirmado não introduzido por este trabalho). Os scripts seguintes da cadeia (`release-quality-05`, `promotional-campaigns`) foram executados isoladamente e passam. Não corrigido, por estar fora do escopo de RS-SERVICOS-01 conforme instrução explícita de não ampliar escopo.

### Suíte completa de Serviços (executada individualmente + sob emulador Firebase, via `firebase-tools emulators:exec`)
Todos os arquivos abaixo foram executados e **passam**:
- `services-domain-tests`, `services-create-ui-01-tests`, `services-e2e-tests`, `services-booking-tests`, `services-work-tests`, `services-quote-tests`, `services-quote-work-link-tests`, `services-pay-tests`, `services-security-tests`, `services-availability-tests`, `services-availability-settings-ui-tests`, `services-agenda-ui-tests` (corrigido), `services-ux-01-dashboard-tests`, `public-service-booking-ui-tests`, `public-service-booking-manage-ui-tests`, `service-work-detail-ui-tests`, `service-public-booking-tests`, `service-public-booking-manage-tests`, `service-booking-contact-tests`.
- Testes de modo de negócio: `business-mode-bootstrap-tests`, `business-mode-route-guard-tests`, `business-mode-route-tests`, `plan-impl-09-final-tests` (inclui asserção explícita de que o modo `services` suprime a prioridade de "produto vazio" e não esconde nenhum módulo de um vendedor híbrido) — todos PASS.
- O E2E (`services-e2e-tests`) cobre o ciclo completo real com comandos reais: disponibilidade, criação de Booking+Work via booking público (sem criação automática de Client), Agenda do dono, ciclo de vida do Work, Quote↔Work, Payment/Refund a partir do líquido, reagendamento/cancelamento público preservando locks e tokens, isolamento entre tenants.
- Os testes de segurança sob emulador confirmam Firestore Rules corretas para Booking/BookingHold/ScheduleLock/Quote/Payment/Refund/idempotency (nenhuma escrita direta do cliente, isolamento de tenant, `anonymous` sem acesso).
- D1 e D2 aparecem citados explicitamente e **passam** nos testes (`PASS D1 quota, replay, CRM edits/deletion, public projection, reschedule/cancel`; `PASS D2 public confirmations do not auto-create or auto-associate Clients`; entre outros).

### Testes criados
Nenhum teste novo foi criado — a cobertura existente já é extensa e cobre os 10 critérios do BRIEF; nenhuma lacuna de cobertura foi identificada que justificasse um teste novo dentro do escopo desta frente.

## Resultados

**Nenhum "erro conhecido ao salvar novo serviço" foi reproduzido.** `services-create-ui-01-tests` (que exercita a criação real de serviço, incluindo a validação de domínio dentro da transação real) passa integralmente sob emulador. A suspeita de que esse erro fosse o `PLAN_LIFECYCLE_UNAVAILABLE`/503 observado na primeira tentativa **foi descartada**: esse erro só ocorre quando o emulador Firestore não está rodando (`ECONNREFUSED 127.0.0.1:8080`) — um artefato de ambiente, não um bug de produto.

Todos os 10 critérios do BRIEF foram verificados como já atendidos pelo código existente nesta branch, com evidência de teste real (não apenas leitura de código):
1. Novo serviço pode ser criado — `services-create-ui-01-tests` PASS.
2. Serviço salva sem erro — mesmo teste, execução real contra o emulador, PASS.
3. Serviço aparece corretamente após salvar — `services-e2e-tests`/`services-ux-01-dashboard-tests` PASS.
4. Somente Serviços sem UI de Produtos — `plan-impl-09-final-tests` (DASH3-DASH4) PASS.
5. Agenda — `services-agenda-ui-tests` (corrigido) + `services-e2e-tests` PASS.
6. Reserva pública — `public-service-booking-ui-tests`, `service-public-booking-tests`, `service-public-booking-manage-tests` PASS.
7. Trabalhos — `services-work-tests`, `service-work-detail-ui-tests` PASS.
8. Contato/snapshot e D1/D2 — `service-booking-contact-tests` (PASS D1/D2 explícitos) + `services-security-tests` PASS.
9. Cobertura de teste dos fluxos — suíte extensa já existente, confirmada passando; 2 asserções desatualizadas corrigidas.
10. Typecheck/lint/testes relevantes — `npm run check` PASS, `npm run lint` PASS, todos os testes relevantes de Serviços PASS (exceto 1 falha pré-existente fora de escopo em LGPD/Catálogo).

## Pendências

1. **Fora de escopo, não corrigido:** `script/lgpd-anpd-remediation-01-tests.ts` falha (asserção desatualizada em `shared/public-catalog.ts` sobre exposição de `pixKey`) — pré-existente, não relacionada a Serviços. Deve ser tratada em frente própria (fora de RS-SERVICOS-01).
2. A maior parte da suíte de Serviços (todos os arquivos `services-*-tests.ts` exceto `services-domain-tests.ts`) **não está incluída** no script `npm test` do `package.json` — só roda manualmente ou sob emulador dedicado. Isso não bloqueia a conclusão desta frente (os testes existem e passam), mas é um gap de wiring de CI que vale registrar para decisão humana (fora do escopo desta execução, que não deve ampliar-se para mexer em `package.json`).
3. Evidência real de UI (screenshots/uso manual no app) **não foi coletada** nesta sessão — a verificação foi feita via a suíte de testes automatizados (extensa e sob emulador real), não via interação manual no app rodando. Conforme o próprio BRIEF, "nenhum item é considerado concluído sem evidência real trazida pelo usuário" — este relatório fornece evidência de teste automatizado, não substitui validação manual do usuário na build.

## Próximo passo

1. Usuário validar manualmente o fluxo de criação de serviço e Somente Serviços numa build real (Android/web), já que a suíte automatizada não substitui a evidência manual exigida pelo BRIEF.
2. Decidir (fora desta frente) se a suíte completa de Serviços deve ser adicionada ao `npm test`/CI.
3. Abrir frente própria para a falha pré-existente de LGPD/Catálogo (`pixKey` em `shared/public-catalog.ts`), não coberta por RS-SERVICOS-01.
