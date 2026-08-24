# Itens dos Termos de Uso que precisam de revisão jurídica

**Origem:** achado P1 "cláusula de jurisdição/arbitragem tensiona com proteção ao consumidor brasileiro" da auditoria `REVENDASMART-LGPD-ANPD-AUDIT-01`. Construído pela `REVENDASMART-LGPD-ANPD-REMEDIATION-01`, Fase 12.

Este documento **não altera** `client/public/terms-of-service.md` (o documento vigente e servido aos usuários). Não é papel deste processo reescrever unilateralmente uma cláusula contratual vinculante — isso é uma decisão jurídica, não uma correção técnica. O que segue é: (1) o item marcado como `NEEDS_LEGAL_REVIEW_FOR_BRAZILIAN_CONSUMERS`, e (2) uma proposta de redação alternativa para avaliação por quem tem competência jurídica — não uma conclusão definitiva.

## Item sinalizado

**NEEDS_LEGAL_REVIEW_FOR_BRAZILIAN_CONSUMERS**

Localização: `client/public/terms-of-service.md`, seção 15 ("Lei Aplicável e Disputes").

Texto vigente:

> ### Lei Que Se Aplica
> Estes termos são regidos pelas leis da **jurisdição em que RevendaSmart é hospedado** (Google Cloud/EUA).
>
> ### Resolução de Conflitos
> 1. **Tentativa Amigável** — Primeiro entre em contato conosco
> 2. **Mediação** — Se não resolver, tentaremos mediar
> 3. **Arbitragem** — Qualquer ação legal será via arbitragem, não tribunal

### Por que isso foi sinalizado

O público-alvo declarado do RevendaSmart (seção 3 dos próprios Termos) é o revendedor brasileiro independente. Submeter esse público a lei estrangeira e a arbitragem obrigatória, em vez de tribunal, é o tipo de cláusula que a legislação brasileira de proteção ao consumidor (CDC) costuma tratar como abusiva em contratos de adesão com a parte mais fraca — especialmente quando impede o acesso à Justiça brasileira. Isso não é uma conclusão definitiva desta auditoria (que é técnica, não jurídica) — é o motivo pelo qual o item precisa de revisão por quem tem competência para essa análise.

## Proposta alternativa (rascunho — não vinculante até revisão jurídica)

Uma direção comum para produtos operando com usuários brasileiros é: lei brasileira como aplicável, foro do usuário (ou foro definido por lei, ex. domicílio do consumidor) para disputas, e arbitragem como opção facultativa (não obrigatória) ou limitada a valores/casos específicos. Um rascunho de redação alternativa, **apenas como ponto de partida para quem for revisar**:

> ### Lei Que Se Aplica
> Estes termos são regidos pelas leis da República Federativa do Brasil.
>
> ### Resolução de Conflitos
> 1. **Tentativa Amigável** — Antes de qualquer ação formal, as partes buscarão resolver a questão diretamente, pelo canal de suporte.
> 2. **Mediação** — Caso não haja acordo, as partes podem buscar mediação.
> 3. **Foro** — Eventuais disputas judiciais serão submetidas ao foro do domicílio do usuário, conforme legislação brasileira aplicável, sem prejuízo de outras opções que a lei garanta ao usuário.

Esta proposta **não foi validada juridicamente** — está aqui só para dar um ponto de partida concreto a quem for revisar, não para ser copiada diretamente para o documento vigente sem análise.

## O que precisa acontecer antes de qualquer mudança no documento real

1. Confirmação da identidade jurídica formal do responsável pelo RevendaSmart (mesma pendência já registrada em `docs/DPO_SMALL_PROCESSING_AGENT_ASSESSMENT.md`) — sem isso, nem a cláusula atual nem a proposta têm a quem se vincular com precisão.
2. Validação por profissional habilitado de que a redação alternativa (ou outra) está de acordo com o CDC e a LGPD para o modelo de negócio real.
3. Só depois de 1 e 2, atualizar `client/public/terms-of-service.md` com o texto aprovado — e, na mesma revisão, confirmar que a seção correspondente da Política de Privacidade não contradiz a versão final.

## Outros pontos menores observados nos Termos (não bloqueantes, registrados por completude)

- Apêndice A promete direitos "GDPR"/"CCPA" a usuários fora do Brasil — não é contraditório com a operação atual, mas vale confirmar que a empresa realmente pretende operar sob essas jurisdições antes de manter a promessa.
- Seção 12 ("O Que Acontece" na exclusão de conta) já está alinhada com o comportamento real do código (`server/account-deletion.ts`) — nenhuma ação necessária aqui.
