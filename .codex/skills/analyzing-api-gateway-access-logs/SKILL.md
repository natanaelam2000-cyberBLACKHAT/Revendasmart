---
name: analyzing-api-gateway-access-logs
description: Adaptar análise para Cloud Run/Cloud Logging: enumeração, bots, scraping, abuso e falhas de auth.
version: 1.0.0
source: Anthropic-Cybersecurity-Skills adapted for Revenda Smart
sourceCommit: 673da1f3b0b7be34ffc9624ef3858fe45f1c3bed
adaptedFrom:
  - skills/analyzing-api-gateway-access-logs/SKILL.md
license: Apache-2.0
tags:
  - cloud
  - revendasmart
  - security
  - tier-s
riskLevel: medium
defaultMode: REVIEW_ONLY
allowedEnvironments:
  - local
  - firebase-emulator
  - authorized-staging
prohibitedEnvironments:
  - production
  - third-party-accounts
  - destructive-data
  - exfiltration
triggers:
  - analyzing api gateway access logs
  - Adaptar análise para Cloud Run/Cloud Logging: enumeração, bots, scraping, abuso 
---
# analyzing-api-gateway-access-logs

## Objetivo

Adaptar análise para Cloud Run/Cloud Logging: enumeração, bots, scraping, abuso e falhas de auth.



## Escopo Revenda Smart

Arquivos e módulos normalmente relevantes:

- `server/index.ts`
- `scripts/security/verify-cloud-run-secrets.sh`
- `scripts/security/migrate-cloud-run-secrets.sh`

## Pré-condições obrigatórias

- Confirmar o repositório correto em `/home/natanaelam2000/Revendasmart`.
- Confirmar `git status` antes de qualquer alteração.
- Não fazer commit.
- Não fazer deploy.
- Não imprimir segredos.
- Não executar testes em produção.
- Não alterar regra de negócio, Mercado Pago, Firebase, Cloud Run ou Play Store sem autorização explícita.
- Usar contas de teste e dados sintéticos para qualquer validação ativa.

## Modos permitidos

- `REVIEW_ONLY`: leitura, diagnóstico e plano. Modo padrão obrigatório.
- `SAFE_FIX`: correções pequenas, locais e rastreáveis, quando explicitamente autorizadas.
- `LOCAL_TEST`: testes com localhost, Firebase Emulator e dados sintéticos.
- `STAGING_ACTIVE_TEST`: somente com autorização explícita, staging do Revenda Smart, contas de teste, backup e limite de escopo.

## Workflow seguro

1. Delimitar escopo, ambiente e objetivo da revisão.
2. Ler os arquivos relevantes antes de propor qualquer comando.
3. Classificar achados por impacto, risco, custo e momento ideal.
4. Em `REVIEW_ONLY`, entregar diagnóstico e evidência mínima sem alterar arquivos.
5. Em `SAFE_FIX`, aplicar somente correções pequenas, compatíveis e reversíveis.
6. Em testes locais/staging, parar após confirmar a vulnerabilidade ou a ausência dela.
7. Registrar riscos aceitos e próximos passos sem ampliar o escopo por curiosidade.

## Validações recomendadas

- `npm run check`
- `npm run build`
- `npm run lint`
- `npm run test`
- `git diff --check`
- Validações específicas do módulo revisado, sempre em ambiente permitido.

## Critérios de parada

Pare imediatamente se a ação exigir produção, dados reais de terceiros, alteração financeira, rotação real de segredo, IAM real, destruição de dados, exfiltração, persistência, evasão, ataque volumétrico ou deploy.

## Entregáveis

- Arquivos analisados.
- Achados com prioridade.
- Evidência mínima e sanitizada.
- Correções aplicadas, se houver.
- Riscos restantes.
- Próximos passos seguros.

## Cross-reference de performance Revenda Smart

Esta skill mantém seu foco principal em segurança, governança ou abuso. Para investigar fluidez, custo, latência ou regressão de experiência sem duplicar escopo, use em conjunto com:

- `monitoring-real-user-performance`
- `revendasmart-performance-observability`
- `revendasmart-cloud-run-latency-review`

Não executar carga, interceptação ou testes ativos contra produção. Use apenas `REVIEW_ONLY` por padrão e ambientes local, emulator ou staging explicitamente autorizado.
