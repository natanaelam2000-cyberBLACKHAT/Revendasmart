# Skills Ranking - Revenda Smart

## Critério

- Tier S: indispensável agora para segurança, isolamento, IAM, secrets, privacidade e incidentes.
- Tier A: antes de produção ampla ou beta real.
- Tier B: condicional a infraestrutura, maturidade ou necessidade específica.
- Tier C: futuro.

## Decisões da baseline

|tier|name|decision|application|
|---|---|---|---|
|Tier S|testing-api-for-broken-object-level-authorization|implemented-adapted|Testar isolamento multitenant e BOLA/IDOR em produtos, clientes, vendas, cobranças, relatórios, catálogo e arquivos.|
|Tier S|testing-api-for-mass-assignment-vulnerability|implemented-adapted|Evitar atualização indevida de premiumActive, role, ownerId, uid, status financeiro, plano, admin e campos protegidos.|
|Tier S|testing-api-authentication-weaknesses|implemented-adapted|Revisar rotas sem autenticação, tokens inválidos, revogados, usuários desativados e reautenticação.|
|Tier S|implementing-devsecops-security-scanning|implemented-adapted|Definir pipeline defensivo com scans de segredo, SAST, dependências, container e quality gates.|
|Tier S|implementing-secret-scanning-with-gitleaks|implemented-adapted|Detectar Mercado Pago tokens, Firebase keys, service accounts, envs, zips, OAuth secrets e DSNs.|
|Tier S|auditing-gcp-iam-permissions|implemented-adapted|Revisar IAM, service accounts, Secret Manager, Cloud Run e Firebase Admin com menor privilégio.|
|Tier S|testing-jwt-token-security|implemented-adapted|Revisar Firebase ID token, expiração, revogação, custom claims, issuer, audience e assinatura.|
|Tier S|performing-sca-dependency-scanning-with-snyk|implemented-adapted|Analisar dependências npm com alternativa livre: npm audit, OSV, Dependabot e Advisory DB.|
|Tier S|analyzing-sbom-for-supply-chain-vulnerabilities|implemented-adapted|Preparar SBOM do frontend/backend/container e análise de vulnerabilidades transitivas.|
|Tier S|detecting-typosquatting-packages-in-npm-pypi|implemented-adapted|Detectar pacotes npm com nomes semelhantes, risco de typosquatting e dependency confusion.|
|Tier S|analyzing-api-gateway-access-logs|implemented-adapted|Adaptar análise para Cloud Run/Cloud Logging: enumeração, bots, scraping, abuso e falhas de auth.|
|Tier S|analyzing-cloud-storage-access-patterns|implemented-adapted|Revisar Firebase Storage/GCS para acesso cruzado, downloads anormais, scraping e uploads suspeitos.|
|Tier S|performing-privacy-impact-assessment|implemented-adapted|Avaliar LGPD: clientes, telefones, e-mails, vendas, cobranças, histórico e retenção.|
|Tier S|implementing-gdpr-data-subject-access-request|implemented-adapted|Adaptar DSAR para LGPD: acesso, correção, exportação, anonimização, exclusão e retenção.|
|Tier S|building-incident-response-playbook|implemented-adapted|Playbooks para vazamento, invasão, pagamento incorreto, credencial exposta, webhook abusado e indisponibilidade.|
|Tier A|implementing-github-advanced-security-for-code-scanning|implemented-adapted|Preparar CodeQL/code scanning conforme plano real do GitHub, sem assumir licença paga.|
|Tier A|implementing-api-security-testing-with-42crunch|implemented-adapted|Condicional a OpenAPI; se não houver contrato, recomendar OpenAPI antes de ferramenta.|
|Tier A|detecting-serverless-function-injection|implemented-adapted|Adaptar para Cloud Run/Express/Firestore/templates/payloads externos.|
|Tier A|conducting-mobile-app-penetration-test|implemented-adapted|Preparar checklist para APK/AAB staging, sem executar antes de build Android autorizado.|
|Tier A|performing-api-rate-limiting-bypass|implemented-adapted|Revisar bypass de rate limit apenas local/emulator/staging autorizado; nunca produção.|
|Tier A|conducting-cloud-incident-response|implemented-adapted|Adaptar resposta a incidente para Google Cloud, Firebase, Cloud Run e Secret Manager.|
|Tier A|analyzing-web-server-logs-for-intrusion|implemented-adapted|Adaptar para Cloud Logging e logs estruturados do Revenda Smart.|
|Tier A|implementing-sigstore-for-software-signing|implemented-adapted|Avaliar assinatura/provenance para container, SBOM e futuros AAB/APK.|
|Tier A|implementing-attack-surface-management|implemented-adapted|Inventariar Vercel, Cloud Run, Firebase, Storage, domínios, webhooks, OAuth callbacks e catálogo.|
|Tier A|testing-android-intents-for-vulnerabilities|implemented-adapted|Condicional a projeto Android/Capacitor; revisão defensiva de intents.|
|Tier A|exploiting-deeplink-vulnerabilities|implemented-adapted|Renomear mentalmente para revisão defensiva de deep links; nunca testar em produção.|
|Tier A|intercepting-mobile-traffic-with-burpsuite|implemented-adapted|Somente build de teste e ambiente autorizado; nunca capturar dados reais.|
|Tier A|performing-web-application-penetration-test|implemented-adapted|Somente staging autorizado e escopo fechado; default review only.|
|Tier A|testing-for-open-redirect-vulnerabilities|implemented-adapted|Aplicar a OAuth, Mercado Pago, login, catálogo e redirects internos.|
|Tier A|configuring-oauth2-authorization-flow|implemented-adapted|Revisar Firebase Auth e Mercado Pago OAuth: state, nonce, allowlist e PKCE quando aplicável.|
|Tier A|detecting-oauth-token-theft|implemented-adapted|Monitoramento defensivo, rotação, revogação e sinais de roubo de token OAuth.|
|Tier B|exploiting-server-side-request-forgery|future-conditional|Adaptar como revisão defensiva de SSRF apenas se backend aceitar URLs de usuário.|
|Tier B|performing-blind-ssrf-exploitation|future-conditional|Futuro/condicional; nunca produção; somente ambiente descartável.|
|Tier B|implementing-aqua-security-for-container-scanning|future-conditional|Avaliar alternativas livres: Trivy, Artifact Analysis, Docker Scout, Grype.|
|Tier B|auditing-terraform-infrastructure-for-security|future-conditional|Somente se Terraform existir.|
|Tier B|auditing-cloud-with-cis-benchmarks|future-conditional|Adaptar para Google Cloud/Firebase.|
|Tier B|analyzing-supply-chain-malware-artifacts|future-conditional|Para investigação de dependência suspeita.|
|Tier B|auditing-tls-certificate-transparency-logs|future-conditional|Monitorar certificados dos domínios Revenda Smart.|
|Tier B|analyzing-typosquatting-domains-with-dnstwist|future-conditional|Monitorar domínios falsos.|
|Tier B|analyzing-certificate-transparency-for-phishing|future-conditional|Monitorar phishing e certificados inesperados.|
|Tier B|analyzing-indicators-of-compromise|future-conditional|Resposta a incidentes.|
|Tier B|implementing-canary-tokens-for-network-intrusion|future-conditional|Somente após revisão legal/operacional; não em dados de clientes.|
|Tier B|analyzing-network-traffic-for-incidents|future-conditional|Somente investigação autorizada.|
|Tier B|analyzing-network-traffic-with-wireshark|future-conditional|Somente ambiente controlado.|
|Tier C|implementing-hardware-security-key-authentication|future|Futuro para administradores.|
|Tier C|performing-soc2-type2-audit-preparation|future|Futuro quando houver exigência comercial.|
|Tier C|auditing-mcp-servers-for-tool-poisoning|future|Futuro quando MCP tiver acesso ao projeto/infra.|
|Tier C|detecting-ai-model-prompt-injection-attacks|future|Futuro quando app tiver IA própria.|
|Tier C|implementing-llm-guardrails-for-security|future|Futuro quando IA executar ações/acessar dados.|
|Tier C|exploiting-jwt-algorithm-confusion-attack|future|Baixa prioridade; Firebase valida tokens; somente teste controlado.|
|Tier C|automating-ioc-enrichment|future|Fase madura de segurança.|
|Tier C|performing-ios-app-security-assessment|future|Futuro quando houver iOS.|
|Tier C|analyzing-ios-app-security-with-objection|future|Futuro quando houver iOS e autorização explícita.|

## Implementadas

- Tier S implementadas/adaptadas: 15
- Tier A implementadas/adaptadas: 16
- Tier B/C documentadas como condicionais/futuras: 22
- Skills próprias Revenda Smart: 38
- Adicionais segunda varredura: 8
