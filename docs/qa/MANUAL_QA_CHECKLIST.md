# Checklist Manual de QA — Revenda Smart

Use dados sintéticos. Não usar dados reais de clientes e não gerar cobrança real.

## Android/PWA

- [ ] Instalar PWA do zero e confirmar nome `Revenda Smart`.
- [ ] Validar ícone sem cantos brancos após limpar cache/desinstalar.
- [ ] Abrir em 360x800, 390x844, 412x915 e tablet.
- [ ] Confirmar bottom navigation não cobre modais, carrinho, forms e CTAs.
- [ ] Abrir teclado em cadastro de produto, cliente, venda, settings e Mercado Pago.
- [ ] Testar offline/online e atualização de cache.

## Onboarding

- [ ] Novo usuário consegue pular.
- [ ] Novo usuário consegue continuar depois.
- [ ] Onboarding não reaparece em loop.
- [ ] Tema muda sem reload.
- [ ] Múltiplos nichos mostram seletor claro.
- [ ] Categorias personalizadas aparecem somente no usuário correto.

## Fluxos principais

- [ ] Cadastrar, editar e excluir produto com imagem.
- [ ] Produto legado com categoria desconhecida continua editável.
- [ ] Cadastrar, editar e excluir cliente.
- [ ] Registrar venda à vista.
- [ ] Registrar venda a prazo com parcelas.
- [ ] Tentar vender estoque insuficiente.
- [ ] Criar cobrança em sandbox.
- [ ] Resync de cobrança sandbox.
- [ ] Conectar/revogar Mercado Pago sandbox.
- [ ] Catálogo público: buscar, carregar mais, carrinho com 1 item e muitos itens.
- [ ] Relatórios: gráficos, impressão e exportação.

## Critério de parada

Pare se aparecer: perda de dados, cobrança real, acesso cruzado, token/segredo em log, tela travada ou erro financeiro.
