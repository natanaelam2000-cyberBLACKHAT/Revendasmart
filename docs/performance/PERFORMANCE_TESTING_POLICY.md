# Performance Testing Policy - Revenda Smart

## Permitido

- `REVIEW_ONLY` em qualquer branch local.
- `SAFE_FIX` para correções pequenas e rastreáveis.
- `LOCAL_TEST` com localhost, Firebase Emulator e dados sintéticos.
- `STAGING_ACTIVE_TEST` somente com autorização explícita, staging próprio, janela controlada e limite de carga.

## Proibido

- Teste de carga em produção.
- DDoS, flood ou tráfego volumétrico sem limite.
- Dados reais de clientes para profiling.
- Alterar Cloud Run, Firebase, Mercado Pago ou regras de negócio sem autorização.
- Instalar dependência pesada sem medir custo.

## Métricas padrão

- Bundle/chunks e gzip.
- LCP, INP e CLS.
- p50/p95/p99 de APIs.
- Firestore reads/listeners por tela.
- Long tasks e memória.
- Tempo de startup/navegação em mobile.


## Proibições permanentes

- Não executar k6, Lighthouse, Burp, Wireshark ou qualquer carga ativa contra produção.
- Não usar dados reais de clientes para teste de performance.
- Não criar writes em massa no Firestore real.
- Não simular abuso contra endpoints Mercado Pago reais.
- Não alterar regras de negócio para passar em budget.

## Ambientes permitidos

- `REVIEW_ONLY`: diagnóstico por código, build e logs já existentes.
- `LOCAL_TEST`: localhost, Firebase Emulator e dados sintéticos.
- `STAGING_ACTIVE_TEST`: apenas com autorização explícita, janela, limites e dados sintéticos.

## Evidência mínima esperada

Cada execução deve registrar comando, ambiente, baseline, resultado, risco restante e se houve alteração de código. Para falhas, parar após confirmar o gargalo; não continuar aumentando carga por curiosidade.
