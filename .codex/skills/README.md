# Revenda Smart Agent Skills

Pacote curado de skills de segurança, operação, produção e regressão para o Revenda Smart.

- Gerado em: 2026-07-12T16:28:15Z
- Repositório externo analisado: `https://github.com/mukul975/Anthropic-Cybersecurity-Skills`
- Commit externo: `673da1f3b0b7be34ffc9624ef3858fe45f1c3bed`
- Modo padrão: `REVIEW_ONLY`
- Produção: proibida para testes ativos
- Impacto no bundle/runtime do app: zero

## Regras globais

- Não fazer commit sem autorização.
- Não fazer deploy sem autorização.
- Não imprimir segredos.
- Não executar testes ofensivos em produção.
- Não alterar regra financeira, Mercado Pago, Firebase, IAM ou Cloud Run sem autorização explícita.
- Usar dados sintéticos e ambiente local/emulator/staging autorizado.

Valide o catálogo com:

```bash
npm run skills:validate
```
