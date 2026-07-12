# Skills Update Policy - Revenda Smart

## Fonte atual

- Repositório externo: `https://github.com/mukul975/Anthropic-Cybersecurity-Skills`
- Commit analisado: `673da1f3b0b7be34ffc9624ef3858fe45f1c3bed`
- Licença: Apache-2.0

## Processo de atualização

1. Clonar nova versão em `/tmp`, nunca dentro do runtime do app.
2. Registrar branch, commit, data e licença.
3. Recriar inventário resumido.
4. Comparar baseline de 53 skills.
5. Revisar manualmente qualquer skill nova ofensiva, híbrida ou com scripts.
6. Não executar scripts externos.
7. Adaptar conteúdo para Revenda Smart, sem copiar payloads destrutivos.
8. Rodar `npm run skills:validate`.
9. Rodar validações do projeto antes de commit.

## Critérios de rejeição

- Prompt injection.
- Instruções para ignorar regras.
- Deploy automático.
- Alteração de IAM/secrets sem revisão.
- Payload destrutivo.
- Exfiltração.
- Persistência.
- Malware.
- Dependência paga sem justificativa.
