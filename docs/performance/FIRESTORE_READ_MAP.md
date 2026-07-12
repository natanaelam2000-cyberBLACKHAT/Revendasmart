# Firestore Read Map — Sprint 4

Objetivo: registrar onde o frontend ainda carrega dados pesados e quais leituras foram reduzidas sem mudar regra de negócio.

## Mapa por tela

| Tela | Hooks/leituras principais | Escopo atual | Risco com 100 docs | Risco com 1.000 docs | Risco com 10.000 docs | Observação |
| --- | --- | --- | --- | --- | --- | --- |
| Dashboard | `useProductsData`, `useSalesData`, `useClientsLiteData` | listeners completos de produtos, vendas e clientes | aceitável | pesado no primeiro load | crítico para custo/latência | KPIs dependem de histórico total; precisa agregados backend-only antes de cortar histórico. |
| Relatórios | `useProductsData`, `useSalesData`, `useClientsLiteData` | listeners completos e cálculo local | aceitável | pesado | crítico | Deve evoluir para período filtrado/agregados mantendo paridade entre tela/exportação. |
| Detalhe do cliente | `useClientDetailData` | cliente + vendas do cliente + produtos referenciados nas vendas | baixo | baixo/médio | médio conforme histórico do cliente | Sprint 4 removeu listener completo de produtos desta tela. |
| Produtos | `usePaginatedProductsData` | primeira página realtime + `loadMore` paginado | baixo | controlado | controlado, busca local só nos carregados | Já usa `limit(30)`, `orderBy("name")` e `startAfter`. |
| Clientes | `usePaginatedClientsData` | primeira página realtime + `getCountFromServer` + `loadMore` | baixo | controlado | controlado | Exporta apenas clientes carregados para evitar varrer tudo. |
| Vendas | `useProductPickerData`, `useClientPickerData` | pickers paginados | baixo | controlado | controlado | Fluxo principal não abre coleções completas. |
| Catálogo interno | `useProductsData` | listener completo de produtos | aceitável | pesado | crítico | Manter por compatibilidade do carrinho/busca local; próxima etapa deve introduzir hook paginado específico. |
| Cobranças | `useCharges`, installments paginados, listener completo de clientes | cobranças/parcelas paginadas; clientes completos para nome/telefone/modais | aceitável | médio | pesado | Melhor saída futura é denormalizar `clientName/clientPhone` em novas cobranças/parcelas com fallback. |
| Vendas mensais | `useMonthlySalesData` + `useProductsData` | vendas do mês limitadas + produtos completos | baixo/médio | médio | pesado se produtos crescerem muito | Produtos completos ainda alimentam nomes/preços; pode evoluir para produtos referenciados. |
| Produtos vendidos | `useMonthlySalesData` + `useProductsData` | vendas do mês limitadas + produtos completos | baixo/médio | médio | pesado | Mesma recomendação de produtos referenciados por vendas. |
| Marketing | `useProductPickerData`, `useMarketingHistory` | produtos paginados + histórico limitado a 200 | baixo | controlado | controlado | Sem listener completo de produtos. |
| Settings | `UserSettingsProvider` e integrações específicas | documento de settings e dados pontuais | baixo | baixo | baixo | Sem coleção pesada na abertura principal. |
| Catálogo público | backend paginado | produtos por página/rate limit | baixo | controlado | controlado | Não expõe custo; paginação preservada. |

## Mudança aplicada nesta sprint

- `client-detail` deixou de usar `useProductsData`.
- `useClientDetailData` agora busca apenas documentos de produtos citados nas vendas do cliente, em lotes de 10 IDs por `documentId() in [...]`.
- A busca de produtos no detalhe do cliente é leitura única (`getDocs`), não listener; os listeners long-lived da tela ficam restritos a cliente e vendas do cliente.

## Leituras ainda caras que não foram alteradas

- Dashboard e Reports continuam corretos, mas dependem de coleções completas para preservar KPIs atuais.
- Catálogo interno ainda usa busca/carrinho local sobre todos os produtos.
- Cobranças ainda precisa de clientes completos para modais e resolução de contato.

Esses pontos devem ser tratados com agregados backend-only, hooks específicos e denormalização segura, não com cache financeiro frágil no frontend.
