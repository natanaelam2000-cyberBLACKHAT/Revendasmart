# Skills Execution Policy - Revenda Smart

## Modos

1. `REVIEW_ONLY`: leitura, diagnóstico e plano. Sem alteração.
2. `SAFE_FIX`: correções pequenas, locais, rastreáveis e de baixo risco.
3. `LOCAL_TEST`: testes em localhost/Firebase Emulator com dados sintéticos.
4. `STAGING_ACTIVE_TEST`: exige autorização explícita, staging do Revenda Smart, backup, escopo, limite e critério de parada.

## Proibido

- Produção para testes ativos.
- Contas de terceiros.
- Destruição de dados.
- Exfiltração.
- Persistência.
- Evasão.
- Ataques volumétricos.
- Rotação real de segredo sem aprovação.
- Deploy sem aprovação.
- Commit automático.
- Alteração financeira sem aprovação.

## Critério de parada

Pare ao confirmar a vulnerabilidade, ao detectar risco destrutivo, ao precisar de produção, ao precisar de credenciais reais, ou ao encontrar mudança que altere regra de negócio.
