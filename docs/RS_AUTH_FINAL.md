# RS-AUTH-FINAL — 2026-10-06

## Resultado

Implementação e validação realizadas exclusivamente em `codex/auth-final-2026-10-06-r2`, no worktree `C:\Users\natan\Documents\revendasmart-auth-final-r2`, criado a partir de `10f0f4ef4785c398dae02da31c2e1699990a8285`. Branch, HEAD inicial e árvore limpa foram conferidos antes das alterações.

**STATUS=BLOCKED**: os fluxos web de email/senha, verificação, recuperação, sessão e exclusão passaram com a aplicação e os emuladores reais. Google foi exercitado com credenciais explicitamente emuladas. OAuth real de Google/Facebook e execução Android ainda exigem configuração externa e validação em dispositivo. Nenhum login real de provedor foi declarado aprovado.

## Fonte de verdade e arquitetura

O Firebase Auth JS fornece usuário, UID, provedores e tokens. O backend valida o ID token com revogação habilitada; a exclusão também valida UID e `auth_time`. `rs:session` é um espelho de compatibilidade do UID autenticado para telas locais, sincronizado por um listener global. Seu conteúdo não autentica requisições. Senhas, ID tokens e credenciais pendentes não são gravados por código novo em localStorage.

`auth-controller.ts` coordena operações, impede envios concorrentes, limita reenvio de verificação, mantém credenciais de colisão apenas na memória por cinco minutos e exige confirmação para vincular. `auth-lifecycle.ts` usa as operações oficiais do SDK. Web usa popup; Android obtém credenciais com `skipNativeAuth:true` e as entrega ao Firebase JS, mantendo uma sessão de aplicação.

## Mudanças e evidências

| Fluxo | Correção | Evidência |
| --- | --- | --- |
| Email/senha | Email normalizado; senha preservada; proteção contra duplo envio; erros modernos tratados sem imprimir objetos de credenciais | Testes direcionados, SDK real emulado, navegador |
| Cadastro | Conta criada uma vez; envio de verificação com falha não destrói nem recria a conta | SDK emulado e navegador |
| Verificação | Reenvio, cooldown de 60 segundos após sucesso, recarga do usuário e renovação do token | Testes direcionados e código de ação aplicado no emulador pelo navegador |
| Recuperação | Mesma confirmação para email existente/inexistente; falhas de rede continuam recuperáveis | Testes direcionados e navegador |
| Google/Facebook | Botões web, popup, erro de cancelamento/bloqueio, adaptador nativo e verificação de configuração | Código integrado; Google emulado; OAuth externo pendente |
| Vinculação | Confirmação explícita, autenticação recente, email correspondente para credencial pendente, UID preservado e nenhuma transferência de dados | Testes direcionados; SDK real emulado preserva UID e rejeita credencial já utilizada |
| Sessão | Login espera persistência e bootstrap; espelho de UID acompanha restauração, mudança de usuário e logout | Testes direcionados, regressão Auth P0 e navegador |
| Logout | Não depende do sucesso da configuração de persistência; limpeza continua após falha de armazenamento | Teste de falha, teste de limpeza e navegador |
| Exclusão | Frase explícita e confirmação de identidade; token vinculado ao usuário confirmado; servidor exige autenticação recente antes de qualquer exclusão | Testes direcionados, backend/emuladores e navegador |
| Exclusão parcial | Falha local após exclusão no servidor recebe aviso específico; falha no servidor mantém opção de retry | Teste de limpeza e estados de erro do navegador |
| Segurança | `verifyIdToken(..., true)`, UID do token, rejeição de `auth_time` antigo, códigos de erro sem credenciais nos novos logs | Testes direcionados e isolamento real da exclusão |

As mudanças de Configurações foram limitadas ao painel de segurança da conta e ao logout. As mudanças de backend foram limitadas à exigência de autenticação recente para exclusão. As frentes proibidas não receberam alterações de implementação. O bloco de Indicação do cadastro foi preservado.

## Validação

- `npm run test:auth-final`: 46 testes, todos aprovados, incluindo conta social sem email e proteção do UID original durante operações assíncronas.
- `npm run test:auth-p0-01`: regressão de bootstrap, token atual, concorrência, troca de UID e isolamento de tenant. O teste conta os listeners globais separadamente e continua exigindo exatamente um listener de bootstrap para os chamadores concorrentes.
- `npm run test:auth-final:firebase:run`: SDK real com Auth Emulator; cadastro duplicado, senha fraca, códigos de ação, vinculação Google, UID estável, recusa de transferência de credencial e logout aprovados.
- `script/account-deletion-tests.ts`: Auth/Firestore/Storage reais emulados; exclusão isolada e rejeição do acesso antigo aprovadas.
- `npm run test:e2e:auth-final:run`: três testes Chromium aprovados, incluindo primeira execução/relogin, verificação/recuperação/persistência e exclusão completa.
- `npm run check -- --tsBuildInfoFile .tmp/auth-tsbuildinfo`: aprovado.
- `npm run lint`: aprovado, com um aviso já existente sobre `_discardedOrdersLabel` em Configurações. Lint adicional dos arquivos de Auth também executado.
- `npm run build`: cliente e servidor aprovados com o script original do projeto.
- `git diff --check`: aprovado.
- `capacitor update android`: aprovado; referências Gradle normalizadas para `../node_modules`, sem caminhos dependentes da máquina nos arquivos versionados.

O runtime usa o projeto `demo-revendasmart` e serviços locais nas portas 9099/8080/9199. Auth, Firestore, Storage e API são reais nesse ambiente. Analytics, Installations, Remote Config, Performance, fontes e ilustrações externas são isolados por fixtures de teste. As respostas 409/500 de bloqueio/retry da exclusão são simulações explícitas; a exclusão final usa o backend real. O teste de primeira execução registra como aviso conhecido o `<a>` aninhado de Produtos, confirmado na base canônica e fora desta implementação de Auth.

Uma instalação interrompida por falta de disco ficou em `.tmp/incomplete-dependencies` neste worktree. Bibliotecas previamente disponíveis em artefatos da conversa foram usadas somente para leitura; bibliotecas necessárias ao bundle foram copiadas para o r2. Escritas de build, caches e resultados ficaram no r2. Os scripts de teste suportam `AUTH_TEST_LINKED_DEPS=1` para esse ambiente restrito. Nenhuma dependência dos outros worktrees foi alterada.

## Pendências externas e critérios de conclusão

### Web — Google e Facebook

Habilitar os provedores no mesmo projeto Firebase usado pelo frontend e verificar seus domínios autorizados. Para Facebook, cadastrar App ID/App Secret no Firebase Console e o URI `https://<authDomain>/__/auth/handler` na configuração OAuth da Meta. App Secret não deve entrar no frontend, Gradle ou Git. Verificar a política de uma conta por email e testar colisões entre provedores em contas de teste reais.

Depois executar login novo/existente, cancelamento, popup bloqueado, reautenticação, vinculação com UID estável e credencial já usada. Também validar os templates e links reais de verificação/recuperação. O emulador não valida consentimento, revisão do app Meta ou credenciais reais dos provedores.

### Android

O app nativo é `com.revendasmart.app`. É necessário fornecer o `android/app/google-services.json` correto, atualmente ausente e ignorado pelo Git. A configuração deve pertencer ao mesmo projeto do Auth JS. Registrar SHA-1 de debug, release e certificado de assinatura do app na Play; baixar novamente o arquivo após alterações. O Gradle impede geração de app sem essa configuração.

Facebook usa `REVENDASMART_FACEBOOK_APP_ID` e `REVENDASMART_FACEBOOK_CLIENT_TOKEN` no ambiente do build. Esses valores públicos geram recursos Android e o scheme de retorno. O SDK só é inicializado quando ambos existem; o bridge informa disponibilidade sem expor identificadores ou credenciais. Configurar também o app Android, package/activity e hashes na Meta. Executar a sincronização Capacitor com o bundle final antes do build nativo.

Validar em aparelho: Google/Facebook, cancelamento/retorno, restauração da sessão após reinício, troca de conta, logout, vinculação e exclusão com reautenticação. Nenhum APK/AAB, deploy ou alteração de console foi realizado nesta execução.

## Referências oficiais

- [Firebase — vinculação de contas](https://firebase.google.com/docs/auth/web/account-linking)
- [Firebase — Google Sign-In](https://firebase.google.com/docs/auth/web/google-signin)
- [Firebase — Facebook Login](https://firebase.google.com/docs/auth/web/facebook-login)
- [Capawesome — Firebase Authentication](https://capawesome.io/docs/sdks/capacitor/firebase/authentication/)
- [Capawesome — configuração Google](https://github.com/capawesome-team/capacitor-firebase/blob/main/packages/authentication/docs/setup-google.md)
- [Capawesome — configuração Facebook](https://github.com/capawesome-team/capacitor-firebase/blob/main/packages/authentication/docs/setup-facebook.md)

## Saída RS-AUTH-FINAL

```text
AUTH_AUDIT=PASS
EMAIL_PASSWORD=PASS
EMAIL_VERIFICATION=PASS
PASSWORD_RECOVERY=PASS
GOOGLE_AUTH=PARTIAL
FACEBOOK_AUTH=PARTIAL
ACCOUNT_LINKING=PARTIAL
DUPLICATE_PREVENTION=PASS
SESSION_PERSISTENCE=PASS
LOGOUT=PASS
ACCOUNT_DELETION=PASS
AUTH_SECURITY=PASS
TARGETED_TESTS=PASS
CHECK=PASS
LINT=PASS
BUILD=PASS
DIFF_CHECK=PASS
WEB_RUNTIME=PASS
GOOGLE_RUNTIME=PARTIAL
FACEBOOK_RUNTIME=PARTIAL
STATUS=BLOCKED
```

Os hashes de commit, HEAD final e a confirmação de árvore limpa são obtidos do Git após o commit e entregues na resposta final, evitando gravar um hash autorreferente neste arquivo.

## Bloqueio de commit nesta sessão

Todos os testes e checks acima passaram. O git add foi recusado ao criar .git/worktrees/revendasmart-auth-final-r2/index.lock, mesmo após concessão de escrita no .git compartilhado e nos caminhos específicos de índice/objetos/refs. Nenhum commit foi criado. HEAD permanece na base canônica; as alterações estão somente no r2 e a árvore está suja. OAuth real e Android também continuam pendentes.
