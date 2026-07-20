# Próximos Passos — Homologação Revenda Smart

## Agora, antes do próximo commit

1. Revisar esta documentação de QA.
2. Confirmar se a correção do smoke test live opcional deve entrar no mesmo commit da auditoria.
3. Rodar validações finais no Cloud Shell.
4. Commitar apenas arquivos de QA + `script/smoke-tests.ts`, se aprovado.

## Antes de deploy controlado

1. Rodar Firebase Emulator Suite para Rules com usuários sintéticos A/B.
2. Rodar Sandbox Mercado Pago completo: OAuth, cobrança, webhook, assinatura, cancelamento e token revogado.
3. Fazer QA visual Android/PWA em aparelho real.
4. Confirmar Cloud Run/Secret Manager/IAM via comandos somente leitura.
5. Decidir política de `marketingHistory`: local-only, backend ou rule explícita.

## Antes de beta

1. Criar suite Playwright ou equivalente para fluxos críticos.
2. Automatizar testes de isolamento multitenant em emulator.
3. Medir Core Web Vitals em staging autorizado.
4. Testar performance com dados sintéticos grandes.
5. Revisar logs frontend restantes e migrar gradualmente para safe logger.

## Antes da Play Store

1. Build Android/AAB de staging.
2. Testar Play Integrity/App Check se implementado.
3. Validar Data Safety, política de privacidade, exclusão de conta e termos.
4. Rodar checklist mobile completo em aparelho intermediário.
5. Rodar rollback drill.

## Backlog futuro ? An?ncios Premium com descri??o assistida por IA

- Status: futuro, n?o implementado nesta hotfix.
- Escopo proposto: sugerir descri??es comerciais para cards de Marketing usando IA somente com a??o expl?cita do usu?rio.
- Pr?-condi??es: pol?tica de privacidade revisada, consentimento claro, limites de custo, logs sem dados sens?veis e op??o de editar antes de salvar/compartilhar.
- Fora do escopo atual: nenhuma IA generativa foi adicionada ao runtime, ao backend ou aos fluxos de an?ncios.
