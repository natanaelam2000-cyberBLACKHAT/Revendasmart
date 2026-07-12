# Matriz de Regressão — Revenda Smart

| Área | Risco | Evidência nesta auditoria | Status | Prioridade |
|---|---|---|---|---|
| Smoke tests | Teste padrão chamava produção | Corrigido para `RUN_LIVE_PUBLIC_CATALOG_SMOKE=1` | CORRIGIDO | P2 |
| Nichos | Categorias genéricas vazarem para nichos específicos | Teste comportamental adicionado | PASS | P1 |
| Temas | Tema inválido quebrar app | Teste comportamental adicionado | PASS | P2 |
| Catálogo público | Voltar a carregar coleção completa | Smoke estático verifica paginação e ausência de `.get()` completo | PASS | P1 |
| Mercado Pago | Fallback silencioso para conta central | Smoke estático + inspeção | PASS | P0 |
| Vendas | Estoque/venda sem transação | `runTransaction` confirmado por inspeção | PASS | P0 |
| Firestore Rules | Escrita client em cobranças/conexões/plano | Deny por inspeção | PASS | P0 |
| UX mobile | Modal/bottom nav/carrinho/teclado | Não revalidado com aparelho | BLOCKED | P1 |
| Android/PWA | Ícone/cache/instalação | Exige aparelho real | BLOCKED | P1 |
| Relatórios | Exportação PDF/Excel/print | Build passa; comportamento real não validado | PARTIAL | P2 |
