# Third-party Skills Review

## Fonte analisada

- Repositório: `https://github.com/mukul975/Anthropic-Cybersecurity-Skills`
- Branch: `main`
- Commit: `673da1f3b0b7be34ffc9624ef3858fe45f1c3bed`
- Data do commit: `2026-06-26T16:37:35+02:00`
- Data da análise: `2026-07-12T16:28:15Z`
- Licença identificada: Apache-2.0

## Contagens reais do commit analisado

- `SKILL.md`: 817
- Diretórios: 2768
- Arquivos: 4536
- Scripts nomeados: 1094
- Executáveis: 15
- Domínios frontmatter únicos: 1
- Subdomínios frontmatter únicos: 46

## Metodologia

1. Clonagem em `/tmp/Anthropic-Cybersecurity-Skills` fora do projeto.
2. Nenhum script externo foi executado.
3. Todos os `SKILL.md` foram lidos para inventário e metadados resumidos.
4. A baseline de 53 skills foi localizada por nome/pasta quando possível.
5. Tier S e Tier A foram adaptadas como skills defensivas para o Revenda Smart.
6. Tier B e Tier C foram documentadas como condicionais/futuras para não inflar o catálogo e evitar testes fora de fase.
7. Conteúdo ofensivo não foi copiado literalmente; foi convertido em workflow defensivo, com `REVIEW_ONLY` por padrão.
8. Uma segunda varredura buscou skills adicionais por termos de Firebase, GCP, API, OAuth, webhook, mobile, supply chain e privacidade.

## Riscos de supply chain encontrados

- O repositório contém skills ofensivas, híbridas e defensivas; algumas incluem procedimentos que não devem ser executados em produção.
- Há muitos scripts auxiliares no repositório externo; nenhum foi executado ou importado.
- Algumas skills usam ferramentas pagas ou ambientes não existentes no Revenda Smart; foram adaptadas para alternativas livres ou marcadas como futuras.
- Algumas skills têm foco em malware, forense ofensiva ou tráfego de rede e não são adequadas ao estágio atual do produto.

## Política adotada

- Produção é ambiente proibido para testes ativos.
- Toda skill potencialmente ofensiva fica em `REVIEW_ONLY` por padrão.
- Qualquer `STAGING_ACTIVE_TEST` exige autorização explícita, dados sintéticos, backup, escopo e critério de parada.
- Nenhum payload destrutivo, malware, exfiltração ou teste volumétrico foi importado.

## Baseline avaliada

|tier|name|found|path|decision|reason|
|---|---|---|---|---|---|
|Tier S|testing-api-for-broken-object-level-authorization|True|skills/testing-api-for-broken-object-level-authorization/SKILL.md|implemented-adapted|Implementada como skill defensiva adaptada ao Revenda Smart.|
|Tier S|testing-api-for-mass-assignment-vulnerability|True|skills/testing-api-for-mass-assignment-vulnerability/SKILL.md|implemented-adapted|Implementada como skill defensiva adaptada ao Revenda Smart.|
|Tier S|testing-api-authentication-weaknesses|True|skills/testing-api-authentication-weaknesses/SKILL.md|implemented-adapted|Implementada como skill defensiva adaptada ao Revenda Smart.|
|Tier S|implementing-devsecops-security-scanning|True|skills/implementing-devsecops-security-scanning/SKILL.md|implemented-adapted|Implementada como skill defensiva adaptada ao Revenda Smart.|
|Tier S|implementing-secret-scanning-with-gitleaks|True|skills/implementing-secret-scanning-with-gitleaks/SKILL.md|implemented-adapted|Implementada como skill defensiva adaptada ao Revenda Smart.|
|Tier S|auditing-gcp-iam-permissions|True|skills/auditing-gcp-iam-permissions/SKILL.md|implemented-adapted|Implementada como skill defensiva adaptada ao Revenda Smart.|
|Tier S|testing-jwt-token-security|True|skills/testing-jwt-token-security/SKILL.md|implemented-adapted|Implementada como skill defensiva adaptada ao Revenda Smart.|
|Tier S|performing-sca-dependency-scanning-with-snyk|True|skills/performing-sca-dependency-scanning-with-snyk/SKILL.md|implemented-adapted|Implementada como skill defensiva adaptada ao Revenda Smart.|
|Tier S|analyzing-sbom-for-supply-chain-vulnerabilities|True|skills/analyzing-sbom-for-supply-chain-vulnerabilities/SKILL.md|implemented-adapted|Implementada como skill defensiva adaptada ao Revenda Smart.|
|Tier S|detecting-typosquatting-packages-in-npm-pypi|True|skills/detecting-typosquatting-packages-in-npm-pypi/SKILL.md|implemented-adapted|Implementada como skill defensiva adaptada ao Revenda Smart.|
|Tier S|analyzing-api-gateway-access-logs|True|skills/analyzing-api-gateway-access-logs/SKILL.md|implemented-adapted|Implementada como skill defensiva adaptada ao Revenda Smart.|
|Tier S|analyzing-cloud-storage-access-patterns|True|skills/analyzing-cloud-storage-access-patterns/SKILL.md|implemented-adapted|Implementada como skill defensiva adaptada ao Revenda Smart.|
|Tier S|performing-privacy-impact-assessment|True|skills/performing-privacy-impact-assessment/SKILL.md|implemented-adapted|Implementada como skill defensiva adaptada ao Revenda Smart.|
|Tier S|implementing-gdpr-data-subject-access-request|True|skills/implementing-gdpr-data-subject-access-request/SKILL.md|implemented-adapted|Implementada como skill defensiva adaptada ao Revenda Smart.|
|Tier S|building-incident-response-playbook|True|skills/building-incident-response-playbook/SKILL.md|implemented-adapted|Implementada como skill defensiva adaptada ao Revenda Smart.|
|Tier A|implementing-github-advanced-security-for-code-scanning|True|skills/implementing-github-advanced-security-for-code-scanning/SKILL.md|implemented-adapted|Implementada como skill defensiva adaptada ao Revenda Smart.|
|Tier A|implementing-api-security-testing-with-42crunch|True|skills/implementing-api-security-testing-with-42crunch/SKILL.md|implemented-adapted|Implementada como skill defensiva adaptada ao Revenda Smart.|
|Tier A|detecting-serverless-function-injection|True|skills/detecting-serverless-function-injection/SKILL.md|implemented-adapted|Implementada como skill defensiva adaptada ao Revenda Smart.|
|Tier A|conducting-mobile-app-penetration-test|True|skills/conducting-mobile-app-penetration-test/SKILL.md|implemented-adapted|Implementada como skill defensiva adaptada ao Revenda Smart.|
|Tier A|performing-api-rate-limiting-bypass|True|skills/performing-api-rate-limiting-bypass/SKILL.md|implemented-adapted|Implementada como skill defensiva adaptada ao Revenda Smart.|
|Tier A|conducting-cloud-incident-response|True|skills/conducting-cloud-incident-response/SKILL.md|implemented-adapted|Implementada como skill defensiva adaptada ao Revenda Smart.|
|Tier A|analyzing-web-server-logs-for-intrusion|True|skills/analyzing-web-server-logs-for-intrusion/SKILL.md|implemented-adapted|Implementada como skill defensiva adaptada ao Revenda Smart.|
|Tier A|implementing-sigstore-for-software-signing|True|skills/implementing-sigstore-for-software-signing/SKILL.md|implemented-adapted|Implementada como skill defensiva adaptada ao Revenda Smart.|
|Tier A|implementing-attack-surface-management|True|skills/implementing-attack-surface-management/SKILL.md|implemented-adapted|Implementada como skill defensiva adaptada ao Revenda Smart.|
|Tier A|testing-android-intents-for-vulnerabilities|True|skills/testing-android-intents-for-vulnerabilities/SKILL.md|implemented-adapted|Implementada como skill defensiva adaptada ao Revenda Smart.|
|Tier A|exploiting-deeplink-vulnerabilities|True|skills/exploiting-deeplink-vulnerabilities/SKILL.md|implemented-adapted|Implementada como skill defensiva adaptada ao Revenda Smart.|
|Tier A|intercepting-mobile-traffic-with-burpsuite|True|skills/intercepting-mobile-traffic-with-burpsuite/SKILL.md|implemented-adapted|Implementada como skill defensiva adaptada ao Revenda Smart.|
|Tier A|performing-web-application-penetration-test|True|skills/performing-web-application-penetration-test/SKILL.md|implemented-adapted|Implementada como skill defensiva adaptada ao Revenda Smart.|
|Tier A|testing-for-open-redirect-vulnerabilities|True|skills/testing-for-open-redirect-vulnerabilities/SKILL.md|implemented-adapted|Implementada como skill defensiva adaptada ao Revenda Smart.|
|Tier A|configuring-oauth2-authorization-flow|True|skills/configuring-oauth2-authorization-flow/SKILL.md|implemented-adapted|Implementada como skill defensiva adaptada ao Revenda Smart.|
|Tier A|detecting-oauth-token-theft|True|skills/detecting-oauth-token-theft/SKILL.md|implemented-adapted|Implementada como skill defensiva adaptada ao Revenda Smart.|
|Tier B|exploiting-server-side-request-forgery|True|skills/exploiting-server-side-request-forgery/SKILL.md|future-conditional|Documentada como condicional/futura para evitar catálogo inchado e testes fora de fase.|
|Tier B|performing-blind-ssrf-exploitation|True|skills/performing-blind-ssrf-exploitation/SKILL.md|future-conditional|Documentada como condicional/futura para evitar catálogo inchado e testes fora de fase.|
|Tier B|implementing-aqua-security-for-container-scanning|True|skills/implementing-aqua-security-for-container-scanning/SKILL.md|future-conditional|Documentada como condicional/futura para evitar catálogo inchado e testes fora de fase.|
|Tier B|auditing-terraform-infrastructure-for-security|True|skills/auditing-terraform-infrastructure-for-security/SKILL.md|future-conditional|Documentada como condicional/futura para evitar catálogo inchado e testes fora de fase.|
|Tier B|auditing-cloud-with-cis-benchmarks|True|skills/auditing-cloud-with-cis-benchmarks/SKILL.md|future-conditional|Documentada como condicional/futura para evitar catálogo inchado e testes fora de fase.|
|Tier B|analyzing-supply-chain-malware-artifacts|True|skills/analyzing-supply-chain-malware-artifacts/SKILL.md|future-conditional|Documentada como condicional/futura para evitar catálogo inchado e testes fora de fase.|
|Tier B|auditing-tls-certificate-transparency-logs|True|skills/auditing-tls-certificate-transparency-logs/SKILL.md|future-conditional|Documentada como condicional/futura para evitar catálogo inchado e testes fora de fase.|
|Tier B|analyzing-typosquatting-domains-with-dnstwist|True|skills/analyzing-typosquatting-domains-with-dnstwist/SKILL.md|future-conditional|Documentada como condicional/futura para evitar catálogo inchado e testes fora de fase.|
|Tier B|analyzing-certificate-transparency-for-phishing|True|skills/analyzing-certificate-transparency-for-phishing/SKILL.md|future-conditional|Documentada como condicional/futura para evitar catálogo inchado e testes fora de fase.|
|Tier B|analyzing-indicators-of-compromise|True|skills/analyzing-indicators-of-compromise/SKILL.md|future-conditional|Documentada como condicional/futura para evitar catálogo inchado e testes fora de fase.|
|Tier B|implementing-canary-tokens-for-network-intrusion|True|skills/implementing-canary-tokens-for-network-intrusion/SKILL.md|future-conditional|Documentada como condicional/futura para evitar catálogo inchado e testes fora de fase.|
|Tier B|analyzing-network-traffic-for-incidents|True|skills/analyzing-network-traffic-for-incidents/SKILL.md|future-conditional|Documentada como condicional/futura para evitar catálogo inchado e testes fora de fase.|
|Tier B|analyzing-network-traffic-with-wireshark|True|skills/analyzing-network-traffic-with-wireshark/SKILL.md|future-conditional|Documentada como condicional/futura para evitar catálogo inchado e testes fora de fase.|
|Tier C|implementing-hardware-security-key-authentication|True|skills/implementing-hardware-security-key-authentication/SKILL.md|future|Documentada como condicional/futura para evitar catálogo inchado e testes fora de fase.|
|Tier C|performing-soc2-type2-audit-preparation|True|skills/performing-soc2-type2-audit-preparation/SKILL.md|future|Documentada como condicional/futura para evitar catálogo inchado e testes fora de fase.|
|Tier C|auditing-mcp-servers-for-tool-poisoning|True|skills/auditing-mcp-servers-for-tool-poisoning/SKILL.md|future|Documentada como condicional/futura para evitar catálogo inchado e testes fora de fase.|
|Tier C|detecting-ai-model-prompt-injection-attacks|True|skills/detecting-ai-model-prompt-injection-attacks/SKILL.md|future|Documentada como condicional/futura para evitar catálogo inchado e testes fora de fase.|
|Tier C|implementing-llm-guardrails-for-security|True|skills/implementing-llm-guardrails-for-security/SKILL.md|future|Documentada como condicional/futura para evitar catálogo inchado e testes fora de fase.|
|Tier C|exploiting-jwt-algorithm-confusion-attack|True|skills/exploiting-jwt-algorithm-confusion-attack/SKILL.md|future|Documentada como condicional/futura para evitar catálogo inchado e testes fora de fase.|
|Tier C|automating-ioc-enrichment|True|skills/automating-ioc-enrichment/SKILL.md|future|Documentada como condicional/futura para evitar catálogo inchado e testes fora de fase.|
|Tier C|performing-ios-app-security-assessment|True|skills/performing-ios-app-security-assessment/SKILL.md|future|Documentada como condicional/futura para evitar catálogo inchado e testes fora de fase.|
|Tier C|analyzing-ios-app-security-with-objection|True|skills/analyzing-ios-app-security-with-objection/SKILL.md|future|Documentada como condicional/futura para evitar catálogo inchado e testes fora de fase.|

## Segunda varredura: skills adicionais selecionadas

|name|path|score|riskLevel|reason|
|---|---|---|---|---|
|securing-serverless-functions|skills/securing-serverless-functions/SKILL.md|8|high|Complementa baseline em API/cloud/privacy/supply-chain/mobile.|
|implementing-cloud-waf-rules|skills/implementing-cloud-waf-rules/SKILL.md|7|medium|Complementa baseline em API/cloud/privacy/supply-chain/mobile.|
|testing-mobile-api-authentication|skills/testing-mobile-api-authentication/SKILL.md|6|high|Complementa baseline em API/cloud/privacy/supply-chain/mobile.|
|implementing-api-gateway-security-controls|skills/implementing-api-gateway-security-controls/SKILL.md|5|high|Complementa baseline em API/cloud/privacy/supply-chain/mobile.|
|conducting-api-security-testing|skills/conducting-api-security-testing/SKILL.md|4|high|Complementa baseline em API/cloud/privacy/supply-chain/mobile.|
|detecting-broken-object-property-level-authorization|skills/detecting-broken-object-property-level-authorization/SKILL.md|3|high|Complementa baseline em API/cloud/privacy/supply-chain/mobile.|
|detecting-shadow-api-endpoints|skills/detecting-shadow-api-endpoints/SKILL.md|2|medium|Complementa baseline em API/cloud/privacy/supply-chain/mobile.|
|implementing-api-rate-limiting-and-throttling|skills/implementing-api-rate-limiting-and-throttling/SKILL.md|1|medium|Complementa baseline em API/cloud/privacy/supply-chain/mobile.|

## Política de atualização

Para atualizar o pacote, clone uma nova versão em `/tmp`, registre o novo commit, gere novo inventário, reavalie a baseline, rode `npm run skills:validate` e compare o diff. Não aceite alterações automáticas de skills ofensivas sem revisão humana.
