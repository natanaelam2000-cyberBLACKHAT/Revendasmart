# Recompra inteligente V1

## Fonte de verdade

`server/sale-finalize-transaction.ts` grava `users/{uid}/sales/{id}` com `clientId`, `date` ISO UTC e `products[]` contendo `productId`, `quantity` e `price`, além de `totalPrice`. A finalização valida cliente/produto e atualiza estoque e datas na mesma transação. Regras Firestore não permitem escrita de vendas pelo cliente. Não existe campo canônico de cancelamento/estorno no finalizador atual. Registros históricos com sinais explícitos de cancelamento, estorno ou exclusão são excluídos; estados desconhecidos também. Não se cria coleção de histórico alternativa.

## Regra determinística

`shared/repeat-purchase.ts` agrupa vendas por cliente + produto. No máximo os seis últimos dias distintos de compra entram no cálculo; linhas repetidas e transações divididas no mesmo dia UTC contam uma vez. Exige pelo menos três dias de compra, dois intervalos e mediana entre 7 e 90 dias. Cada intervalo deve estar dentro de ±25% da mediana, com tolerância mínima de dois dias. Isso acomoda duração de meses e pequenas variações de calendário, mas rejeita rajadas de compras e padrões irregulares. Quantidade não multiplica o número de compras.

O disparo começa exatamente em `última compra + mediana`, sem antecipação, e termina após `max(7 dias, 25% da mediana)`. A janela expira para não apresentar um ciclo antigo como abordagem oportuna. Esses limites são escolhas conservadoras de V1, não uma previsão validada estatisticamente; podem perder recorrências reais fora desse intervalo. A razão arredonda dias e diz “aproximadamente”. Prioridade `medium`; magnitude interna são dias desde a data esperada, usando a ordenação geral existente.

Fingerprint: `repeat_purchase` + par cliente/produto sem ambiguidade (prefixo com comprimento do ID do cliente) + timestamp da última compra válida. Nova compra muda o ciclo e adia a próxima oportunidade. Os seis dias recentes evitam perpetuar padrões antigos. Vendas sem total positivo, datas canônicas válidas, IDs simples de até 100 caracteres ou itens com quantidade positiva não alimentam o cálculo. Datas futuras são rejeitadas. Cliente/produto ausente, preservado pelo plano ou com tenantUid contraditório e produto sem estoque disponível impedem a oportunidade.

## Custo e isolamento

Uma consulta nas 500 vendas mais recentes dos últimos 365 dias do tenant, ordenada por `date`, usa o índice simples existente. Agrupamento em memória; até 30 pares candidatos e um único `getAll` com até 60 referências distintas de clientes/produtos, todas sob `users/{uid}`. Não há N+1, collectionGroup ou gravação na detecção. O motor mantém o limite de resposta de 30; o dashboard usa seus três primeiros itens sem nova ordenação.

Esta é uma amostra limitada: lojas com mais de 500 vendas anuais podem ter padrões antigos omitidos. O limite de 30 pares é aplicado antes da validação de entidades e da filtragem de ações; pares inválidos ou já tratados podem reduzir a quantidade mostrada. Não há busca adicional para preencher a lista. O histórico de ações continua com o limite existente de 500 registros recentes.

## Ações e resultados

Mensagem determinística com nome/produto, sem alegar certeza, score ou rastreamento. Componentes existentes fornecem WhatsApp/cópia ou Ver cliente/cópia quando não há telefone plausível. Navegar, abrir WhatsApp e copiar não gravam ação. Feito cria awaiting_result; converted/no_result são sempre explícitos. Uma nova venda nunca atribui conversão automaticamente. Endpoints reutilizam o gate Premium/trial e a autorização existente de administrador. Free não chama o motor no cliente e recebe 403 diretamente no servidor.

## Bundle e validação

Apresentação do feedback (ícones e estilos) foi extraída para `UserFeedbackToast`, carregado sob demanda. Listener e temporizador permanecem montados no host, com mensagem acessível imediata enquanto carrega. Não há algoritmo de recompra no PrivateRouter. Budget original preservado.

Regra pura e integração real com Firestore/Auth/rotas: `npm run test:plan-impl-07a`. Inclui mínimos de histórico, inconsistência, duplicatas, cancelamentos, ausências, isolamento, gating, novo ciclo, deduplicação e outcome manual.

Browser: `tests/e2e/repeat-purchase.spec.ts`, junto de `daily-priorities.spec.ts` e `opportunity-outcomes.spec.ts`, com API real + emuladores locais e viewport 375px. WhatsApp interceptado para validar URL sem enviar mensagens. Validação geral: `npm run check`, `npm test`, `npm run build`, `npm run performance:bundle-check`, `npm run lint` e ESLint nos módulos alterados.
