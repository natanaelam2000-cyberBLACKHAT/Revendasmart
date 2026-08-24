# Procedimento de atendimento a solicitações de titulares (LGPD)

**Origem:** achado P1 da auditoria `REVENDASMART-LGPD-ANPD-AUDIT-01` — "nenhum mecanismo/processo para clientes do lojista exercerem direitos LGPD". Este documento é o procedimento interno mínimo pedido pela `REVENDASMART-LGPD-ANPD-REMEDIATION-01`, Fase 2. Não é um portal automatizado — é o processo operacional que o suporte segue hoje, manualmente, até que (se algum dia fizer sentido) parte dele seja automatizada.

## 1. Dois tipos de titular, dois processos diferentes

### A. Titular = usuário do RevendaSmart (o lojista)

O lojista tem conta própria e, na maior parte dos casos, pode resolver sozinho dentro do app:

- **Acesso/correção**: os próprios dados de conta e loja (`user_settings/{uid}`) são editáveis em Configurações.
- **Portabilidade**: a função de backup em Configurações → Segurança exporta um JSON com todos os dados operacionais associados à conta (`rs:{uid}:*`).
- **Exclusão**: fluxo próprio em `/account-deletion` (ver `server/account-deletion.ts`), que remove Firebase Auth, Firestore (`users/{uid}` recursivo, `user_settings/{uid}`, `admin_users/{uid}`), Storage (`users/{uid}/**`) e referências cruzadas de referral.

Pedidos que não podem ser resolvidos pelo próprio app (ex.: dúvida sobre o que foi coletado, contestação de uma decisão, pedido de portabilidade em outro formato) seguem para o canal de suporte: **revendasmart.suporte@gmail.com**.

### B. Titular = cliente cadastrado por um lojista (o caso crítico)

Aqui o lojista é o **controlador** desse tratamento (ele decide cadastrar o nome/telefone/notas de alguém) e o RevendaSmart é o **operador** — processa esses dados em nome do lojista, sem decidir a finalidade. **O RevendaSmart não tem, hoje, uma forma de identificar de forma independente "quem é esse titular" nem de localizar seus dados sem passar pelo lojista** — o registro só existe dentro da conta do lojista (`users/{uid}/clients/{clientId}`, e nos snapshots de nome/telefone em `orders`/`sales`/`installments`/`charges`).

Isso significa que **o RevendaSmart, como operador, não pode atender esse pedido sozinho** — ele precisa repassar ao lojista (o controlador) ou, quando o lojista não responde, atuar dentro do que a LGPD permite a um operador (art. 39: o operador realiza o tratamento segundo as instruções do controlador).

## 2. Procedimento (para o titular tipo B — cliente de um lojista)

1. **Identificação do pedido.** Todo pedido chega por `revendasmart.suporte@gmail.com`. Registrar: nome de quem pede, telefone/e-mail que a pessoa acredita estar cadastrado, e — se souber — o nome da loja/lojista que fez o cadastro. Sem isso, é operacionalmente impossível localizar o registro (não existe um índice global de "todos os clientes com este telefone" — é uma busca dentro da conta de um lojista específico).

2. **Validação mínima.** Confirmar que quem está pedindo é de fato o titular (ex.: confirmar posse do telefone/e-mail informado) antes de agir. Um pedido que só informa um nome comum, sem loja identificada e sem forma de confirmar identidade, deve ser respondido pedindo mais informação — nunca deve ser executado às cegas.

3. **Localização dos dados.** Suporte identifica a loja (`user_settings.catalogSlug` ou e-mail do lojista) e localiza o registro correspondente em `users/{uid}/clients`, e os snapshots em `orders`/`sales`/`installments`/`charges` que referenciam esse `clientId`.

4. **Execução.**
   - **Acesso**: suporte comunica ao lojista o pedido e, com autorização do lojista (controlador), repassa ao titular quais dados existem.
   - **Correção**: repassada ao lojista, que edita diretamente na tela de Clientes.
   - **Exclusão/anonimização**: repassada ao lojista, que apaga o registro em Clientes (a UI já permite excluir um cliente). Se o lojista não responder em prazo razoável e o pedido for legítimo e verificável, escalar (ver item 6) — o RevendaSmart não deve, por padrão, apagar dados de terceiros dentro da conta de outro usuário sem envolver o controlador, exceto em caso de determinação legal.
   - **Oposição/revogação**: mesma lógica — repassar ao lojista, que é quem decide manter ou não o cadastro (dentro dos limites legais dele).

5. **Registro.** Toda solicitação, independentemente do desfecho, deve ser registrada (data, tipo de pedido, loja envolvida, desfecho) para fins de auditoria e para responder a uma eventual fiscalização da ANPD. Enquanto não houver uma tabela/coleção dedicada para isso, o registro mínimo é o próprio e-mail arquivado com uma tag de assunto padronizada (ex.: `[LGPD-TITULAR-TERCEIRO]`).

6. **Escalonamento.** Se o lojista não responder, se recusar sem justificativa legal, ou se houver indício de que os dados foram obtidos de forma irregular, o pedido deve ser escalado para decisão humana com acesso administrativo — nunca automatizado. Casos envolvendo suspeita de dado de menor, dado sensível fora do escopo esperado (nome/telefone/notas comerciais), ou risco à segurança do titular têm prioridade.

7. **Exceções legais.** Pedidos de exclusão podem esbarrar em obrigações legais de retenção do próprio lojista (ex.: nota fiscal, obrigação tributária) — isso é responsabilidade do lojista como controlador, não do RevendaSmart. O suporte deve comunicar essa possível limitação ao titular sem se posicionar como se fosse o RevendaSmart quem decide reter por essas razões.

8. **Comunicação ao controlador.** Sempre que um pedido de titular tipo B chegar, o lojista (controlador) deve ser informado de que recebeu um pedido relacionado a um dos clientes cadastrados por ele — tanto para dar transparência quanto porque, legalmente, é ele quem deve decidir/executar a maior parte da resposta.

## 3. Prazo de resposta

A Política de Privacidade vigente (`client/public/privacy-policy.md`) não define um prazo fixo — diz que "o escopo e o formato de atendimento dependem das regras aplicáveis e de decisão operacional do responsável". Este procedimento não inventa um prazo que a política não assume. Recomenda-se, como boa prática (não como compromisso jurídico já assumido publicamente), tratar pedidos de titulares tipo B com a mesma prioridade dos pedidos tipo A.

## 4. O que este documento explicitamente NÃO cria

- Não cria um portal de autoatendimento para clientes de lojistas.
- Não cria uma API para consulta de dados por terceiros.
- Não promete um prazo legal específico (isso depende de decisão jurídica formal, ainda pendente — ver `docs/DPO_SMALL_PROCESSING_AGENT_ASSESSMENT.md`).
- Não altera a divisão de responsabilidade controlador/operador descrita acima — essa divisão é uma leitura técnica do fluxo de dados, não uma conclusão jurídica definitiva.

## 5. Referências cruzadas

- `server/account-deletion.ts` — fluxo de exclusão do titular tipo A.
- `firestore.rules:155-160` — campos permitidos em `clients` (o que existe para ser localizado).
- `docs/DATA_RETENTION_REGISTER.md` — prazos de retenção aplicáveis.
- `docs/PRIVACY_INCIDENT_RESPONSE.md` — se o pedido revelar um incidente (ex.: dado vazado), seguir esse runbook em paralelo.
