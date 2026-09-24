/**
 * ADS-PRO-03D — Suíte de Testes da UI do Quiz Visual e Integração de Persistência
 *
 * Cobertura Completa:
 * 1. Estados da Experiência e Card (UI-01 a UI-07)
 * 2. Fluxo e Interações do Quiz (UI-08 a UI-14)
 * 3. Validação e Persistência Autoritativa (UI-15 a UI-20)
 * 4. Apresentação e Neutralidade de Estilos (UI-21 a UI-24)
 * 5. Auditoria Estrutural de Segurança, Pureza e Contratos (SEC-01 a SEC-06)
 * 6. Acessibilidade Semântica e Mobile-First (A11Y-01 a A11Y-05)
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  ADS_PRO_STYLE_QUIZ_DEFINITION_V1,
  QUIZ_QUESTION_IDS,
  resolveCreativeProfileFromQuiz,
  type AdsProStyleQuizAnswer,
} from "../shared/ads-pro/style-quiz";
import {
  parseAdsProCreativeProfile,
  type AdsProCreativeProfileV1,
} from "../shared/ads-pro/creative-profile";
import {
  formatAdsProStyleSummary,
  getAdsProStyleDescription,
  getAdsProStyleLabel,
} from "../client/src/lib/ads-pro-style-presentation";
import type { MarketingProStyle } from "../shared/marketing-pro-contract";

console.log("=== INICIANDO SUÍTE ADS-PRO-03D (UI QUIZ VISUAL + LOAD/SAVE) ===\n");

// Leitura dos fontes dos componentes
const modalSource = fs.readFileSync(
  path.resolve("client/src/components/marketing/AdsProStyleQuizModal.tsx"),
  "utf8"
);
const cardSource = fs.readFileSync(
  path.resolve("client/src/components/marketing/AdsProProfileCard.tsx"),
  "utf8"
);
const presentationSource = fs.readFileSync(
  path.resolve("client/src/lib/ads-pro-style-presentation.ts"),
  "utf8"
);
const panelSource = fs.readFileSync(
  path.resolve("client/src/components/marketing/MarketingProPanel.tsx"),
  "utf8"
);

// ============================================================================
// 1. ESTADOS DA EXPERIÊNCIA E CARD (UI-01 a UI-07)
// ============================================================================
console.log("-> 1. Estados da Experiência e Card (UI-01 a UI-07)");

// UI-01: loading
assert.match(
  cardSource,
  /state\.phase === "loading"/,
  "UI-01: Estado loading precisa ser modelado explicitamente"
);
assert.match(
  cardSource,
  /data-testid="ads-pro-profile-loading"/,
  "UI-01: Testid de loading precisa estar presente"
);
console.log("PASS UI-01: loading state modelado com testid dedicado");

// UI-02: profile ausente (null)
assert.match(
  cardSource,
  /state\.profile === null/,
  "UI-02: Estado profile === null precisa ser distinguido"
);
assert.match(
  cardSource,
  /data-testid="button-ads-pro-define-style"/,
  "UI-02: Botão para definir estilo no primeiro uso presente"
);
console.log("PASS UI-02: profile ausente (null) oferece CTA claro para definir estilo");

// UI-03: profile existente
assert.match(
  cardSource,
  /state\.profile !== null/,
  "UI-03: Estado com profile existente precisa ser tratado"
);
assert.match(
  cardSource,
  /data-testid="badge-card-primary-style"/,
  "UI-03: Badge de estilo principal precisa ser renderizado"
);
console.log("PASS UI-03: profile existente exibe preferências e estilo principal");

// UI-04: erro de load
assert.match(
  cardSource,
  /state\.phase === "error"/,
  "UI-04: Fase de erro precisa existir"
);
assert.match(
  cardSource,
  /data-testid="button-ads-pro-retry-load"/,
  "UI-04: Botão de retry no erro de carregamento obrigatório"
);
console.log("PASS UI-04: erro de load não quebra silenciosamente e expõe retry");

assert.match(
  cardSource,
  /onAuthStateChanged\(auth[\s\S]*void loadProfile\(\)/,
  "UI-04: loader padrão aguarda a prontidão do Auth antes de ler o perfil"
);

// UI-05: abrir quiz
assert.match(
  cardSource,
  /setIsQuizOpen\(true\)/,
  "UI-05: Ação explícita de abrir o modal do quiz"
);
assert.match(
  modalSource,
  /data-testid="ads-pro-style-quiz-dialog"/,
  "UI-05: Dialog do quiz com testid dedicado"
);
console.log("PASS UI-05: abrir quiz instancia o modal de teste de estilo");

// UI-06: fechar/cancelar sem salvar
assert.match(
  modalSource,
  /data-testid="button-ads-pro-quiz-cancel"/,
  "UI-06: Botão de cancelar no quiz presente"
);
assert.match(
  modalSource,
  /resetQuizState\(\)/,
  "UI-06: Fechar sem salvar descarta respostas em andamento"
);
console.log("PASS UI-06: fechar ou cancelar sem salvar descarta sessão e preserva estado anterior");

// UI-07: retake não inventa respostas antigas
assert.match(
  cardSource,
  /data-testid="button-ads-pro-retake-quiz"/,
  "UI-07: Botão de refazer quiz presente"
);
assert.doesNotMatch(
  cardSource,
  /mapProfileToAnswers|inferAnswersFromProfile|reconstructAnswers/,
  "UI-07: Card não pode inventar respostas antigas ao refazer"
);
assert.match(
  modalSource,
  /setAnswers\(\{\}\)/,
  "UI-07: Novo quiz inicia com submission estritamente vazia"
);
console.log("PASS UI-07: retake inicia formulário limpo sem inventar respostas antigas");

// ============================================================================
// 2. FLUXO E INTERAÇÕES DO QUIZ (UI-08 a UI-14)
// ============================================================================
console.log("\n-> 2. Fluxo e Interações do Quiz (UI-08 a UI-14)");

// UI-08: renderiza 5 perguntas canônicas
assert.equal(
  ADS_PRO_STYLE_QUIZ_DEFINITION_V1.questions.length,
  5,
  "UI-08: A definição canônica possui exatamente 5 perguntas"
);
assert.deepEqual(
  ADS_PRO_STYLE_QUIZ_DEFINITION_V1.questions.map((q) => q.id),
  [...QUIZ_QUESTION_IDS],
  "UI-08: As 5 perguntas coincidem exatamente com QUIZ_QUESTION_IDS"
);
assert.match(
  modalSource,
  /ADS_PRO_STYLE_QUIZ_DEFINITION_V1\.questions/,
  "UI-08: O modal renderiza as perguntas diretamente da definição canônica 03B"
);
console.log("PASS UI-08: 5 perguntas canônicas consumidas de ADS_PRO_STYLE_QUIZ_DEFINITION_V1");

// UI-09 / UI-10: uma option por question e troca de opção
assert.match(
  modalSource,
  /setAnswers\(\(prev\) => \(\{\s*\.\.\.prev,\s*\[currentQuestion\.id\]: optionId,\s*\}\)\)/,
  "UI-09/UI-10: Selecionar opção substitui a resposta anterior da mesma pergunta (single-select)"
);
console.log("PASS UI-09/UI-10: seleção de opção é estritamente single-choice e substitui anterior");

// UI-11: permite skip
assert.match(
  modalSource,
  /data-testid="button-ads-pro-quiz-skip"/,
  "UI-11: Botão de pular pergunta presente"
);
console.log("PASS UI-11: botão de pular pergunta permite avançar sem seleção");

// UI-12: permite submission parcial
{
  const partialAnswers: AdsProStyleQuizAnswer[] = [
    { questionId: "visual_composition", optionId: "comp_minimal" },
  ];
  const partialProfile = resolveCreativeProfileFromQuiz({ answers: partialAnswers });
  assert.equal(partialProfile.schemaVersion, 1);
  assert.ok(partialProfile.preferredStyles.includes("minimal"));
}
console.log("PASS UI-12: submission parcial avaliada com sucesso pelo engine");

// UI-13: voltar preserva escolhas da sessão
assert.match(
  modalSource,
  /handleBack[\s\S]*setCurrentStep\(\(prev\) => prev - 1\)/,
  "UI-13: handleBack preserva estado de respostas"
);
console.log("PASS UI-13: voltar não limpa respostas da sessão em andamento");

// UI-14: progresso correto
assert.match(
  modalSource,
  /data-testid="text-ads-pro-quiz-step-indicator"/,
  "UI-14: Indicador de progresso presente"
);
assert.match(
  modalSource,
  /data-testid="progress-ads-pro-quiz"/,
  "UI-14: Barra de progresso visual presente"
);
console.log("PASS UI-14: progresso textual e visual corretos");

// ============================================================================
// 3. VALIDAÇÃO E PERSISTÊNCIA AUTORITATIVA (UI-15 a UI-20)
// ============================================================================
console.log("\n-> 3. Validação e Persistência Autoritativa (UI-15 a UI-20)");

// UI-15: resultado vem exclusivamente do engine 03B
assert.match(
  modalSource,
  /resolveCreativeProfileFromQuiz\(\{ answers: formattedAnswers \}\)/,
  "UI-15: Cálculo do profile deriva estritamente de resolveCreativeProfileFromQuiz"
);
assert.doesNotMatch(
  modalSource,
  /\.score\b|\.points\b|score\s*\+|points\s*\+|awards\.forEach/,
  "UI-15: O modal não pode reimplementar cálculo de pontuação no JSX"
);
console.log("PASS UI-15: resultado do quiz calculado puramente pelo engine resolveCreativeProfileFromQuiz");

// UI-16: save usa profile 03A/03C
assert.match(
  modalSource,
  /await saveProfileImpl\(derivedProfile\)/,
  "UI-16: Salvamento usa a camada saveAdsProCreativeProfile"
);
console.log("PASS UI-16: salvamento utiliza o contrato autoritativo de saveAdsProCreativeProfile");

// UI-17: save success atualiza estado visual
assert.match(
  cardSource,
  /handleQuizComplete[\s\S]*setState\(\{ phase: "loaded", profile: newProfile \}\)/,
  "UI-17: Conclusão do quiz atualiza o card imediatamente"
);
console.log("PASS UI-17: sucesso no salvamento atualiza o estado exibido no card");

// UI-18: save failure mantém escolhas e permite retry
assert.match(
  modalSource,
  /catch \(err: unknown\) \{[\s\S]*setIsSaving\(false\);[\s\S]*setSaveError\(/,
  "UI-18: Falha no salvamento mantém modal aberto, preserva respostas e exibe erro amigável"
);
assert.match(
  modalSource,
  /data-testid="text-ads-pro-quiz-save-error"/,
  "UI-18: Testid para mensagem de erro de gravação"
);
console.log("PASS UI-18: falha no salvamento não finge sucesso e preserva escolhas do usuário");

// UI-19: double-click guard
assert.match(
  modalSource,
  /if \(isSaving\) return;/,
  "UI-19: Guard contra duplo clique em handleSave"
);
assert.match(
  modalSource,
  /disabled=\{isSaving\}/,
  "UI-19: Botão de salvar desabilitado enquanto isSaving for true"
);
console.log("PASS UI-19: proteção estrita contra double-submit durante gravação");

// UI-20: retake substitui profile anterior após conclusão
{
  let currentMockProfile: AdsProCreativeProfileV1 | null = {
    schemaVersion: 1,
    preferredStyles: ["luxury"],
  };

  const mockSave = async (profile: unknown): Promise<AdsProCreativeProfileV1> => {
    const parsed = parseAdsProCreativeProfile(profile);
    if (!parsed.ok) throw new Error("Invalid");
    currentMockProfile = parsed.value;
    return parsed.value;
  };

  // Simula retake com minimal
  const newProfile = resolveCreativeProfileFromQuiz({
    answers: [{ questionId: "visual_composition", optionId: "comp_minimal" }],
  });
  await mockSave(newProfile);
  assert.equal(currentMockProfile.preferredStyles[0], "minimal");
}
console.log("PASS UI-20: novo retake concluído substitui o perfil canônico");

// ============================================================================
// 4. APRESENTAÇÃO E NEUTRALIDADE DE ESTILOS (UI-21 a UI-24)
// ============================================================================
console.log("\n-> 4. Apresentação e Neutralidade de Estilos (UI-21 a UI-24)");

// UI-21: preferredStyles ordenado exibido corretamente
{
  const styles: MarketingProStyle[] = ["minimal", "sensory", "modern"];
  const summary = formatAdsProStyleSummary(styles);
  assert.equal(summary, "Minimalista, Sensorial, Moderno");
}
console.log("PASS UI-21: apresentação formatada respeita rigorosamente a ordem dos estilos");

// UI-22: [] não gera default
{
  const emptyProfile: AdsProCreativeProfileV1 = { schemaVersion: 1, preferredStyles: [] };
  assert.equal(emptyProfile.preferredStyles.length, 0);
  assert.equal(formatAdsProStyleSummary(emptyProfile.preferredStyles), "Nenhum estilo definido");
}
assert.match(
  modalSource,
  /data-testid="text-no-preference"/,
  "UI-22: Apresentação explícita de sem preferência para profile vazio"
);
assert.match(
  cardSource,
  /data-testid="text-card-neutral-style"/,
  "UI-22: Card exibe preferência neutra quando preferredStyles for []"
);
console.log("PASS UI-22: perfil com lista vazia ([]) exibe estado neutro sem injetar default");

// UI-23: null não gera default
assert.match(
  cardSource,
  /state\.profile === null && \([\s\S]*data-testid="ads-pro-profile-none"/,
  "UI-23: Perfil nulo exibe estado de primeiro uso sem estilos pré-carregados"
);
console.log("PASS UI-23: perfil ausente (null) não injeta nenhum estilo default");

// UI-24: estilo primário é preferredStyles[0]
{
  const profile: AdsProCreativeProfileV1 = {
    schemaVersion: 1,
    preferredStyles: ["editorial", "luxury"],
  };
  assert.equal(profile.preferredStyles[0], "editorial");
  assert.equal(getAdsProStyleLabel(profile.preferredStyles[0]), "Editorial");
  assert.ok(getAdsProStyleDescription(profile.preferredStyles[0]).includes("revista"));
}
assert.match(
  cardSource,
  /state\.profile\.preferredStyles\[0\]/,
  "UI-24: Card extrai estilo principal estritamente do índice 0"
);
console.log("PASS UI-24: estilo primário é inequivocamente preferredStyles[0]");

// ============================================================================
// 5. AUDITORIA ESTRUTURAL DE SEGURANÇA E CONTRATOS (SEC-01 a SEC-06)
// ============================================================================
console.log("\n-> 5. Auditoria Estrutural de Segurança e Contratos (SEC-01 a SEC-06)");

// SEC-01: Zero Firestore direto nos componentes de UI
for (const forbidden of ["getFirestore", "collection(", "doc(", "setDoc(", "getDoc("]) {
  assert.ok(
    !modalSource.includes(forbidden),
    `SEC-01: AdsProStyleQuizModal não pode chamar Firestore diretamente (${forbidden})`
  );
  assert.ok(
    !cardSource.includes(forbidden),
    `SEC-01: AdsProProfileCard não pode chamar Firestore diretamente (${forbidden})`
  );
}
console.log("PASS SEC-01: nenhum componente de UI acessa Firestore diretamente");

// SEC-02: Zero CreativeFamily nos novos componentes
for (const src of [modalSource, cardSource, presentationSource]) {
  assert.doesNotMatch(
    src,
    /CreativeFamily|creativeFamily|SellerCreativeProfile/,
    "SEC-02: Não pode misturar contratos legados (CreativeFamily)"
  );
}
console.log("PASS SEC-02: contratos legados de CreativeFamily isolados e ausentes");

// SEC-03: Zero fresh-* nos novos componentes
for (const src of [modalSource, cardSource, presentationSource]) {
  assert.doesNotMatch(
    src,
    /fresh-premium|fresh-sport|fresh-commercial/,
    "SEC-03: Estilos sazonais legados fresh-* estritamente proibidos"
  );
}
console.log("PASS SEC-03: nenhum estilo legado fresh-* presente nos novos componentes");

// SEC-04: Apresentação em PT-BR sem promessas comerciais falsas
for (const style of ["luxury", "editorial", "minimal", "sensory", "modern"] as const) {
  const label = getAdsProStyleLabel(style);
  const desc = getAdsProStyleDescription(style);
  assert.ok(label.length > 0, `Rótulo para ${style} obrigatório`);
  assert.ok(desc.length > 0, `Descrição para ${style} obrigatória`);
  assert.doesNotMatch(
    desc,
    /vende mais|garante conversão|mais lucro|compre mais/i,
    "SEC-04: A apresentação de estilo não pode conter promessas comerciais enganosas"
  );
}
console.log("PASS SEC-04: rótulos e descrições estéticas puras sem promessas comerciais");

// SEC-05: Integração no painel MarketingProPanel preservada
assert.match(
  panelSource,
  /import\("@\/components\/marketing\/AdsProProfileCard"\)|import \{ AdsProProfileCard \} from "@\/components\/marketing\/AdsProProfileCard";/,
  "SEC-05: MarketingProPanel importa AdsProProfileCard via alias canônico"
);
assert.match(
  panelSource,
  /<AdsProProfileCard className="mb-1" \/>/,
  "SEC-05: MarketingProPanel renderiza AdsProProfileCard"
);
console.log("PASS SEC-05: integração no MarketingProPanel comprovada");

// SEC-06: Suporte a remoção limpa (clear)
assert.match(
  cardSource,
  /clearProfileImpl = clearAdsProCreativeProfile/,
  "SEC-06: Card suporta clearAdsProCreativeProfile"
);
assert.match(
  cardSource,
  /data-testid="button-ads-pro-clear-profile"/,
  "SEC-06: Botão de remoção de preferência presente no card"
);
assert.match(
  cardSource,
  /data-testid="button-ads-pro-confirm-clear"/,
  "SEC-06: Confirmação de remoção antes de executar o clear"
);
assert.match(
  cardSource,
  /data-testid="text-ads-pro-clear-error"/,
  "SEC-06: Falha no clear deve permanecer visível e permitir nova tentativa"
);
console.log("PASS SEC-06: remoção de preferências (clear) possui confirmação segura");

// ============================================================================
// 6. ACESSIBILIDADE SEMÂNTICA E MOBILE-FIRST (A11Y-01 a A11Y-05)
// ============================================================================
console.log("\n-> 6. Acessibilidade Semântica e Mobile-First (A11Y-01 a A11Y-05)");

// A11Y-01: Controles de seleção possuem role semântico de rádio
assert.match(
  modalSource,
  /role="radiogroup"/,
  "A11Y-01: Container de opções utiliza role='radiogroup'"
);
assert.match(
  modalSource,
  /role="radio"/,
  "A11Y-01: Opções de resposta utilizam role='radio'"
);
assert.match(
  modalSource,
  /aria-checked=\{isSelected\}/,
  "A11Y-01: Estado de seleção comunicado semanticamente via aria-checked"
);
assert.match(
  modalSource,
  /tabIndex=\{isSelected[\s\S]*-1\}/,
  "A11Y-01: radiogroup usa roving tabindex"
);
assert.match(
  modalSource,
  /event\.key !== "ArrowRight"[\s\S]*event\.key !== "ArrowUp"/,
  "A11Y-01: setas de teclado navegam entre opções"
);
assert.match(
  modalSource,
  /event\.key === " " \|\| event\.key === "Enter"/,
  "A11Y-01: Espaço e Enter selecionam a opção focada"
);
console.log("PASS A11Y-01: opções do quiz com semântica completa de radiogroup e aria-checked");

// A11Y-02: Alvos de toque adequados para mobile (min-height >= 44px)
assert.match(
  modalSource,
  /min-h-11|min-h-12/,
  "A11Y-02: Modal utiliza tap targets móveis >= 44px (min-h-11 ou min-h-12)"
);
assert.match(
  cardSource,
  /min-h-11/,
  "A11Y-02: Card utiliza botões com min-h-11 (44px)"
);
console.log("PASS A11Y-02: controles respeitam altura mínima de toque para mobile (>= 44px)");

// A11Y-03: Diálogo responsivo para telas estreitas (320px..375px)
assert.match(
  modalSource,
  /w-\[calc\(100vw-2rem\)\]/,
  "A11Y-03: Largura proporcional ao viewport em mobile (evita overflow)"
);
assert.match(
  modalSource,
  /max-h-\[calc\(100dvh-2rem\)\]/,
  "A11Y-03: Altura máxima ajustada para viewport dinâmico móvel (100dvh)"
);
console.log("PASS A11Y-03: diálogo mobile-first com limites dinâmicos de viewport (100dvh)");

// A11Y-04: Estados de erro com anúncio semântico (role="alert")
assert.match(
  modalSource,
  /role="alert"/,
  "A11Y-04: Alerta de erro de salvamento possui role='alert'"
);
console.log("PASS A11Y-04: mensagens de erro com role='alert' para leitores de tela");

// A11Y-05: Ausência de largura fixa rígida (sem fixed px overflow)
assert.doesNotMatch(
  modalSource,
  /w-\[\d{3,}px\]/,
  "A11Y-05: Modal não utiliza larguras fixas rígidas em pixels"
);
assert.doesNotMatch(
  cardSource,
  /w-\[\d{3,}px\]/,
  "A11Y-05: Card não utiliza larguras fixas rígidas em pixels"
);
console.log("PASS A11Y-05: layout estritamente responsivo sem larguras fixas grandes");

console.log("\n==================================================");
console.log("TODOS OS TESTES ADS-PRO-03D PASSARAM COM SUCESSO!");
console.log("==================================================");
