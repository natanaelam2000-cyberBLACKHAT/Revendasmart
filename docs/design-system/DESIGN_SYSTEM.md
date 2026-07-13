# Revenda Smart Design System

## Objetivo

Esta camada define a base visual do Revenda Smart sem adicionar providers, bibliotecas de animação ou lógica de negócio. A troca de tema acontece via CSS variables aplicadas no `document.documentElement` pelo `UserSettingsProvider`.

## Fonte da verdade

- `client/src/lib/app-themes.ts`: catálogo de temas, customização, tokens e aplicação das CSS variables.
- `client/src/index.css`: tokens CSS globais e classes base (`rs-card`, `rs-input`, `rs-badge`, `rs-dialog-surface`, `rs-tabs-list`, `rs-skeleton`).
- `client/src/providers/UserSettingsProvider.tsx`: aplica o tema já carregado de `user_settings`.

## Tokens principais

- `primary`, `secondary`, `accent`
- `surface`, `surfaceSecondary`, `background`, `card`
- `success`, `warning`, `danger`, `info`
- `border`, `muted`, `textPrimary`, `textSecondary`
- `shadow`, `radius`, `spacing`, `transition`, `duration`

Esses tokens são expostos como CSS variables `--rs-*`, por exemplo:

- `--rs-color-primary`
- `--rs-surface`
- `--rs-surface-secondary`
- `--rs-input-bg`
- `--rs-focus-ring`
- `--rs-chart-1`
- `--rs-bottom-nav-bg`
- `--rs-fab-bg`

## Temas disponíveis

- Azul Premium
- Roxo Elegante
- Verde Premium
- Rosa Boutique
- Vermelho Comercial
- Laranja Energia
- Grafite Executivo
- Preto OLED
- Turquesa
- Dourado Premium

IDs legados como `purple`, `blue`, `green`, `rose`, `orange` e `black` foram preservados para compatibilidade.

## Preview em tempo real

O onboarding usa `applyAppTheme()` localmente para preview sem salvar imediatamente. A persistência acontece somente quando o usuário confirma/finaliza o fluxo.

## Identidade da loja

`AppSettings.storeIdentity` prepara campos futuros para nome, logo, cor principal, cor secundária, cor destaque, ícone, slogan e imagem hero. Nesta sprint não há upload novo, bloqueio premium ou migração obrigatória.

## Como adicionar um novo tema

1. Adicionar o ID em `APP_THEME_IDS`.
2. Adicionar o objeto em `APP_THEMES` com `label`, `description`, `primaryColor`, `swatch` e `cssVariables`.
3. Validar com `npm run test` para garantir cobertura no smoke test.
4. Rodar `npm run build` e `npm run performance:bundle-check`.

## Como adaptar componentes

Componentes base devem consumir tokens via classes `rs-*` e Tailwind sem hardcode novo. Cores específicas de integrações externas, como WhatsApp e Mercado Pago, podem permanecer hardcoded quando representam identidade de terceiros.

## Performance

- Sem provider novo.
- Sem context duplicado.
- Sem listener novo.
- Sem dependência nova.
- Troca de tema baseada em CSS variables.
- Preview instantâneo por mutação de CSS variables, sem re-render global obrigatório.
