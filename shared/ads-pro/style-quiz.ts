/**
 * ADS-PRO-03B — Quiz Visual V1 + Scoring Determinístico → Creative Profile
 *
 * Contrato puro, imutável e determinístico que avalia respostas explícitas de estilo visual
 * fornecidas pelo usuário e produz um AdsProCreativeProfileV1 canônico.
 *
 * Princípios Centrais:
 * - Domínio Puro: Zero I/O, zero APIs de rede, zero persistência, zero React/DOM, zero dependência de IA/LLM.
 * - Foco Estrito em Preferência Visual: Não infere nem manipula category, intent, format, entityKind ou preços.
 * - Estilos Restritos: Opera exclusivamente sobre MarketingProStyle (luxury, editorial, minimal, sensory, modern).
 * - CreativeFamily continua estritamente DEFERRED.
 * - Scoring Auditável: Pontuações inteiras discretas (+1, +2), transparentes e explicáveis via breakdown.
 * - Evidência Positiva: Retorna apenas estilos com score > 0. Sem evidência -> preferredStyles: [].
 * - Determinismo e Desempate Canônico: Ordem estável e documentada; ordem das respostas não afeta o resultado.
 * - Imutabilidade: Todos os objetos de entrada e saída são profundamente imutáveis (Object.freeze).
 */

import {
  isMarketingProStyle,
  type MarketingProStyle,
} from "../marketing-pro-contract";
import type { AssetMatchContext } from "./asset-matcher";
import {
  ADS_PRO_CREATIVE_PROFILE_SCHEMA_VERSION,
  type AdCreationContext,
  type AdsProCreativeProfileV1,
  resolveAssetMatchContext,
} from "./creative-profile";

/** Versão estrutural do Quiz de Estilo V1. */
export const ADS_PRO_STYLE_QUIZ_SCHEMA_VERSION = 1 as const;
export type AdsProStyleQuizSchemaVersion = typeof ADS_PRO_STYLE_QUIZ_SCHEMA_VERSION;

/**
 * Ordem canônica e determinística de desempate técnico entre estilos com pontuações idênticas.
 * NOTA IMPORTANTE: Esta ordem serve unicamente como critério de desempate estável e determinístico
 * para evitar qualquer dependência de ordem de iteração, locale ou randomness.
 * Ela NÃO expressa juízo de valor ou superioridade estética entre os estilos visuais.
 */
export const QUIZ_STYLE_TIE_BREAK_ORDER: readonly MarketingProStyle[] = [
  "luxury",
  "editorial",
  "minimal",
  "sensory",
  "modern",
] as const;

/** Identificadores estáveis das 5 perguntas visuais V1. */
export const QUIZ_QUESTION_IDS = [
  "visual_composition",
  "visual_lighting",
  "visual_atmosphere",
  "visual_density",
  "brand_expression",
] as const;
export type QuizQuestionId = (typeof QUIZ_QUESTION_IDS)[number];

/** Atribuição discreta de pontos a um MarketingProStyle. */
export interface StyleAward {
  readonly style: MarketingProStyle;
  readonly points: number;
}

/** Opção de resposta do Quiz Visual V1. */
export interface AdsProStyleQuizOption {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly awards: readonly StyleAward[];
}

/** Pergunta visual estruturada do Quiz V1. */
export interface AdsProStyleQuizQuestion {
  readonly id: QuizQuestionId;
  readonly title: string;
  readonly subtitle: string;
  readonly options: readonly AdsProStyleQuizOption[];
}

/** Definição canônica do Quiz de Estilos V1. */
export interface AdsProStyleQuizDefinition {
  readonly schemaVersion: AdsProStyleQuizSchemaVersion;
  readonly quizId: string;
  readonly title: string;
  readonly description: string;
  readonly questions: readonly AdsProStyleQuizQuestion[];
}

/** Resposta individual a uma pergunta do quiz. */
export interface AdsProStyleQuizAnswer {
  readonly questionId: string;
  readonly optionId: string;
}

/** Submissão de respostas do quiz enviada pelo cliente. */
export interface AdsProStyleQuizSubmission {
  readonly answers: readonly AdsProStyleQuizAnswer[];
}

/** Erro estruturado de validação do quiz. */
export interface StyleQuizValidationError {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

/** Resultado tipado do parser de submissão do quiz. */
export type AdsProStyleQuizParseResult =
  | { readonly ok: true; readonly value: AdsProStyleQuizSubmission }
  | { readonly ok: false; readonly errors: readonly StyleQuizValidationError[] };

/** Detalhe de desempate aplicado durante o scoring. */
export interface StyleQuizTieBreakEvent {
  readonly score: number;
  readonly tiedStyles: readonly MarketingProStyle[];
  readonly resolvedOrder: readonly MarketingProStyle[];
}

/** Breakdown auditável e explicável da pontuação do quiz. */
export interface StyleQuizScoreBreakdown {
  /** Pontuação acumulada por estilo (inclui 0 para estilos sem evidência). */
  readonly styleScores: Readonly<Record<MarketingProStyle, number>>;
  /** Lista ordenada de estilos que receberam evidência positiva (> 0). */
  readonly rankedStyles: readonly MarketingProStyle[];
  /** Contribuições auditáveis por pergunta respondida. */
  readonly contributions: readonly {
    readonly questionId: string;
    readonly optionId: string;
    readonly awards: readonly StyleAward[];
  }[];
  /** Registro de eventuais empates resolvidos pela ordem canônica técnica. */
  readonly tieBreaksApplied: readonly StyleQuizTieBreakEvent[];
}

/** Resultado da avaliação do quiz contendo o CreativeProfileV1 e o breakdown auditável. */
export interface EvaluateStyleQuizResult {
  readonly profile: AdsProCreativeProfileV1;
  readonly breakdown: StyleQuizScoreBreakdown;
}

function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") return obj;
  for (const key of Object.keys(obj)) {
    const val = (obj as Record<string, unknown>)[key];
    if (val !== null && typeof val === "object") {
      deepFreeze(val);
    }
  }
  return Object.freeze(obj);
}

/**
 * Definição canônica oficial do Quiz de Estilo Visual V1 do Ads Pro.
 * Contém exatamente 5 decisões visuais (4 a 6 conforme especificação V1).
 */
export const ADS_PRO_STYLE_QUIZ_DEFINITION_V1: AdsProStyleQuizDefinition = deepFreeze<AdsProStyleQuizDefinition>({
  schemaVersion: ADS_PRO_STYLE_QUIZ_SCHEMA_VERSION,
  quizId: "ads_pro_style_quiz_v1",
  title: "Perfil de Estilo Visual do Anúncios Pro",
  description: "Descubra a identidade visual persistente da sua comunicação publicitária.",
  questions: [
    {
      id: "visual_composition",
      title: "Composição e Estrutura",
      subtitle: "Como você prefere a distribuição dos elementos na tela?",
      options: [
        {
          id: "comp_minimal",
          label: "Foco Puro e Espaçoso",
          description: "Superfície limpa, foco total no produto e amplo espaço negativo ao redor.",
          awards: [{ style: "minimal", points: 2 }],
        },
        {
          id: "comp_editorial",
          label: "Diagramação Editorial",
          description: "Composição estruturada com hierarquia visual clara, estilo catálogo e revista.",
          awards: [{ style: "editorial", points: 2 }],
        },
        {
          id: "comp_dynamic",
          label: "Geometria Contemporânea",
          description: "Linhas modernas, enquadramento dinâmico e ritmo visual funcional.",
          awards: [{ style: "modern", points: 2 }],
        },
        {
          id: "comp_sensory",
          label: "Aproximação Tátil",
          description: "Enquadramento próximo com destaque para textura, curvas e sensação física.",
          awards: [{ style: "sensory", points: 2 }],
        },
      ],
    },
    {
      id: "visual_lighting",
      title: "Iluminação e Contraste",
      subtitle: "Qual tratamento de luz melhor representa a sua marca?",
      options: [
        {
          id: "light_dramatic",
          label: "Refinado e Imponente",
          description: "Contraste refinado com realces contidos, sombras elegantes e presença premium.",
          awards: [{ style: "luxury", points: 2 }],
        },
        {
          id: "light_natural_soft",
          label: "Suave e Acolhedor",
          description: "Luz difusa, tons orgânicos e clima quente com apelo sensorial imediato.",
          awards: [{ style: "sensory", points: 2 }],
        },
        {
          id: "light_clean_balanced",
          label: "Claro e Despojado",
          description: "Iluminação homogênea, sem sombras pesadas ou distrações ópticas.",
          awards: [{ style: "minimal", points: 2 }],
        },
        {
          id: "light_crisp_vibrant",
          label: "Nítido e Funcional",
          description: "Contraste vibrante e luz precisa, garantindo leitura rápida no mobile.",
          awards: [{ style: "modern", points: 2 }],
        },
      ],
    },
    {
      id: "visual_atmosphere",
      title: "Atmosfera da Imagem",
      subtitle: "Qual clima visual traduz o posicionamento desejado?",
      options: [
        {
          id: "atmo_prestigious",
          label: "Alta Sofisticação",
          description: "Acabamento nobre, exclusividade perceptível e sofisticação contida.",
          awards: [{ style: "luxury", points: 2 }],
        },
        {
          id: "atmo_curated",
          label: "Curadoria Cultural",
          description: "Atmosfera refinada de campanha institucional, com respiro e maturidade estética.",
          awards: [{ style: "editorial", points: 2 }],
        },
        {
          id: "atmo_tactile_warm",
          label: "Conexão Sensorial",
          description: "Sensação tátil, frescor e apelo envolvente que desperta o desejo dos sentidos.",
          awards: [{ style: "sensory", points: 2 }],
        },
        {
          id: "atmo_contemporary",
          label: "Urbano e Atual",
          description: "Estética atual, direta ao ponto, conectada ao dinamismo do dia a dia.",
          awards: [{ style: "modern", points: 2 }],
        },
      ],
    },
    {
      id: "visual_density",
      title: "Densidade de Elementos",
      subtitle: "Como você equilibra a quantidade de estímulos na arte?",
      options: [
        {
          id: "density_spacious",
          label: "Mínimo Absoluto",
          description: "Menos é mais: apenas o essencial para valorizar o produto sem ruídos.",
          awards: [{ style: "minimal", points: 2 }],
        },
        {
          id: "density_structured",
          label: "Equilíbrio Diagramado",
          description: "Distribuição harmoniosa de blocos e respiro equilibrado entre as áreas.",
          awards: [{ style: "editorial", points: 2 }],
        },
        {
          id: "density_focused",
          label: "Elegância Funcional",
          description: "Foco claro na mensagem com acabamento sofisticado e moderno.",
          awards: [
            { style: "luxury", points: 1 },
            { style: "modern", points: 1 },
          ],
        },
      ],
    },
    {
      id: "brand_expression",
      title: "Expressão da Marca",
      subtitle: "Se sua marca fosse uma linguagem visual, qual seria?",
      options: [
        {
          id: "expr_exclusive",
          label: "Exclusiva e Rara",
          description: "Transmite prestígio, rigor nos detalhes e alto valor percebido.",
          awards: [{ style: "luxury", points: 2 }],
        },
        {
          id: "expr_editorial",
          label: "Autoral e Elegante",
          description: "Postura madura, elegância clássica e refinamento atemporal.",
          awards: [{ style: "editorial", points: 2 }],
        },
        {
          id: "expr_essential",
          label: "Essencial e Precisa",
          description: "Simplicidade pura, confiança sem ostentação e foco no produto.",
          awards: [{ style: "minimal", points: 2 }],
        },
        {
          id: "expr_authentic",
          label: "Humana e Aconchegante",
          description: "Presença acolhedora, calor emocional e sensorialidade autêntica.",
          awards: [{ style: "sensory", points: 2 }],
        },
        {
          id: "expr_progressive",
          label: "Progressiva e Dinâmica",
          description: "Energia contemporânea, agilidade visual e linguagem conectada ao presente.",
          awards: [{ style: "modern", points: 2 }],
        },
      ],
    },
  ],
});

/** Chaves permitidas no objeto de submissão do quiz. */
const ALLOWED_SUBMISSION_KEYS = new Set(["answers"]);

/** Chaves permitidas em cada item de resposta da submissão. */
const ALLOWED_ANSWER_KEYS = new Set(["questionId", "optionId"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Valida a integridade semântica e estrutural de uma definição de Quiz.
 *
 * Assegura que:
 * 1. Todos os IDs de perguntas e opções são únicos.
 * 2. Todos os prêmios de estilo pertencem exclusivamente a MarketingProStyle.
 * 3. Nenhuma CreativeFamily ou família sazonal ("fresh-*") é admitida no mapping.
 * 4. Nenhum prêmio de categoria ou intenção comercial existe no questionário.
 */
export function validateStyleQuizDefinition(
  definition: AdsProStyleQuizDefinition
): readonly StyleQuizValidationError[] {
  const errors: StyleQuizValidationError[] = [];

  if (!isPlainObject(definition)) {
    return [
      {
        code: "INVALID_DEFINITION_ROOT",
        path: "$",
        message: "Definição do quiz precisa ser um objeto válido",
      },
    ];
  }

  if (definition.schemaVersion !== ADS_PRO_STYLE_QUIZ_SCHEMA_VERSION) {
    errors.push({
      code: "INVALID_SCHEMA_VERSION",
      path: "$.schemaVersion",
      message: `schemaVersion "${String(definition.schemaVersion)}" incompatível`,
    });
  }

  const seenQuestionIds = new Set<string>();

  for (let qIdx = 0; qIdx < definition.questions.length; qIdx += 1) {
    const question = definition.questions[qIdx];
    const qPath = `$.questions[${qIdx}]`;

    if (!question || typeof question.id !== "string" || !question.id.trim()) {
      errors.push({
        code: "INVALID_QUESTION_ID",
        path: `${qPath}.id`,
        message: "Identificador de pergunta inválido",
      });
      continue;
    }

    if (seenQuestionIds.has(question.id)) {
      errors.push({
        code: "DUPLICATE_QUESTION_ID",
        path: `${qPath}.id`,
        message: `ID de pergunta duplicado: "${question.id}"`,
      });
    }
    seenQuestionIds.add(question.id);

    const seenOptionIds = new Set<string>();
    for (let oIdx = 0; oIdx < question.options.length; oIdx += 1) {
      const option = question.options[oIdx];
      const oPath = `${qPath}.options[${oIdx}]`;

      if (!option || typeof option.id !== "string" || !option.id.trim()) {
        errors.push({
          code: "INVALID_OPTION_ID",
          path: `${oPath}.id`,
          message: "Identificador de opção inválido",
        });
        continue;
      }

      if (seenOptionIds.has(option.id)) {
        errors.push({
          code: "DUPLICATE_OPTION_ID",
          path: `${oPath}.id`,
          message: `ID de opção duplicado na pergunta "${question.id}": "${option.id}"`,
        });
      }
      seenOptionIds.add(option.id);

      for (let aIdx = 0; aIdx < option.awards.length; aIdx += 1) {
        const award = option.awards[aIdx];
        const aPath = `${oPath}.awards[${aIdx}]`;

        if (!award || typeof award.style !== "string" || !isMarketingProStyle(award.style)) {
          errors.push({
            code: "INVALID_STYLE_AWARD",
            path: `${aPath}.style`,
            message: `Estilo visual inválido "${String(award?.style)}". Apenas MarketingProStyle é permitido.`,
          });
        }

        if (typeof award?.points !== "number" || award.points <= 0 || !Number.isInteger(award.points)) {
          errors.push({
            code: "INVALID_POINTS_AWARD",
            path: `${aPath}.points`,
            message: `Pontuação precisa ser um número inteiro estritamente positivo em ${aPath}`,
          });
        }
      }
    }
  }

  return Object.freeze(errors);
}

/**
 * Validador e parser seguro (fail-safe) para entrada de submissão do Quiz.
 *
 * Regras estritas:
 * 1. Entrada pode ser `{ answers: [...] }` ou array direto `[...]`.
 * 2. Rejeita qualquer chave de topo desconhecida (ex: score, preferredStyles, category, intent).
 * 3. Rejeita respostas com chaves desconhecidas em cada item.
 * 4. Submissão parcial é totalmente válida (permite pular perguntas).
 * 5. Submissão vazia ([]) é totalmente válida.
 * 6. Rejeita perguntas duplicadas na mesma submissão (DUPLICATE_QUESTION).
 * 7. Rejeita questionId inexistente na definição (UNKNOWN_QUESTION).
 * 8. Rejeita optionId inexistente na pergunta correspondente (INVALID_OPTION_FOR_QUESTION).
 * 9. Nunca lança exceção para entradas inválidas.
 * 10. Nunca muta o input original.
 */
export function parseAdsProStyleQuizSubmission(
  input: unknown,
  definition: AdsProStyleQuizDefinition = ADS_PRO_STYLE_QUIZ_DEFINITION_V1
): AdsProStyleQuizParseResult {
  const errors: StyleQuizValidationError[] = [];

  let rawAnswers: unknown;

  if (Array.isArray(input)) {
    rawAnswers = input;
  } else if (isPlainObject(input)) {
    // Rejeição de chaves desconhecidas no topo (incluindo tentativas de injetar score ou preferredStyles)
    for (const key of Object.keys(input)) {
      if (!ALLOWED_SUBMISSION_KEYS.has(key)) {
        errors.push({
          code: "UNKNOWN_KEY",
          path: `$.${key}`,
          message: `Chave não permitida "${key}" na submissão do Quiz`,
        });
      }
    }

    if (input.answers === undefined) {
      errors.push({
        code: "MISSING_ANSWERS_FIELD",
        path: "$.answers",
        message: "Campo 'answers' é obrigatório quando a submissão é um objeto",
      });
      return { ok: false, errors };
    }

    rawAnswers = input.answers;
  } else {
    return {
      ok: false,
      errors: [
        {
          code: "NOT_AN_OBJECT_OR_ARRAY",
          path: "$",
          message: "Submissão precisa ser um objeto { answers: [...] } ou array de respostas",
        },
      ],
    };
  }

  if (!Array.isArray(rawAnswers)) {
    errors.push({
      code: "INVALID_ANSWERS_FIELD",
      path: "$.answers",
      message: "Campo answers precisa ser um array",
    });
    return { ok: false, errors };
  }

  // Mapeamento de perguntas e opções da definição canônica
  const questionMap = new Map<string, AdsProStyleQuizQuestion>();
  for (const q of definition.questions) {
    questionMap.set(q.id, q);
  }

  const seenQuestions = new Set<string>();
  const validatedAnswers: AdsProStyleQuizAnswer[] = [];

  for (let i = 0; i < rawAnswers.length; i += 1) {
    const item = rawAnswers[i];
    const itemPath = `$.answers[${i}]`;

    if (!isPlainObject(item)) {
      errors.push({
        code: "INVALID_ANSWER_ITEM",
        path: itemPath,
        message: "Cada resposta precisa ser um objeto { questionId, optionId }",
      });
      continue;
    }

    // Rejeição de chaves extras no item da resposta
    for (const key of Object.keys(item)) {
      if (!ALLOWED_ANSWER_KEYS.has(key)) {
        errors.push({
          code: "UNKNOWN_KEY",
          path: `${itemPath}.${key}`,
          message: `Chave não permitida "${key}" na resposta da pergunta`,
        });
      }
    }

    const { questionId, optionId } = item;

    if (typeof questionId !== "string" || !questionId.trim()) {
      errors.push({
        code: "INVALID_QUESTION_ID",
        path: `${itemPath}.questionId`,
        message: "questionId precisa ser uma string não-vazia",
      });
      continue;
    }

    if (typeof optionId !== "string" || !optionId.trim()) {
      errors.push({
        code: "INVALID_OPTION_ID",
        path: `${itemPath}.optionId`,
        message: "optionId precisa ser uma string não-vazia",
      });
      continue;
    }

    // 1. Pergunta conhecida na definição
    const questionDef = questionMap.get(questionId);
    if (!questionDef) {
      errors.push({
        code: "UNKNOWN_QUESTION",
        path: `${itemPath}.questionId`,
        message: `Pergunta desconhecida "${questionId}"`,
      });
      continue;
    }

    // 2. Não permitir duplicata da mesma pergunta
    if (seenQuestions.has(questionId)) {
      errors.push({
        code: "DUPLICATE_QUESTION",
        path: `${itemPath}.questionId`,
        message: `Pergunta "${questionId}" respondida mais de uma vez`,
      });
      continue;
    }

    // 3. Opção precisa pertencer à pergunta informada
    const optionDef = questionDef.options.find((opt) => opt.id === optionId);
    if (!optionDef) {
      errors.push({
        code: "INVALID_OPTION_FOR_QUESTION",
        path: `${itemPath}.optionId`,
        message: `Opção "${optionId}" não pertence à pergunta "${questionId}"`,
      });
      continue;
    }

    seenQuestions.add(questionId);
    validatedAnswers.push(
      Object.freeze({
        questionId,
        optionId,
      })
    );
  }

  if (errors.length > 0) {
    return { ok: false, errors: Object.freeze(errors) };
  }

  return {
    ok: true,
    value: Object.freeze({
      answers: Object.freeze(validatedAnswers),
    }),
  };
}

/**
 * Avalia de forma pura e determinística as respostas do Quiz e deriva o CreativeProfileV1.
 *
 * Propriedades Garantidas:
 * 1. Independência de Ordem: Permutações no array de respostas resultam em pontuações e ordenação estritamente idênticas.
 * 2. Somente Evidência Positiva: Apenas estilos com pontuação > 0 entram em preferredStyles.
 * 3. Ausência de Defaults Ocultos: Se não houver respostas ou pontuação > 0, preferredStyles é [].
 * 4. Desempate Técnico Canônico: Estilos com scores idênticos desempatam pela ordem canônica pré-fixada QUIZ_STYLE_TIE_BREAK_ORDER.
 * 5. Breakdown Completo: Registra scores de cada estilo, contribuições e eventos de desempate para auditoria e debug.
 * 6. Imutabilidade: Retorno profundamente congelado (Object.freeze).
 */
export function evaluateStyleQuiz(
  submission: AdsProStyleQuizSubmission,
  definition: AdsProStyleQuizDefinition = ADS_PRO_STYLE_QUIZ_DEFINITION_V1
): EvaluateStyleQuizResult {
  // Inicialização acumuladora com todos os 5 estilos em 0
  const scores: Record<MarketingProStyle, number> = {
    luxury: 0,
    editorial: 0,
    minimal: 0,
    sensory: 0,
    modern: 0,
  };

  const contributions: {
    questionId: string;
    optionId: string;
    awards: readonly StyleAward[];
  }[] = [];

  // Indexação rápida da definição do quiz
  const questionMap = new Map<string, AdsProStyleQuizQuestion>();
  for (const q of definition.questions) {
    questionMap.set(q.id, q);
  }

  // Processamento cumulativo determinístico das respostas válidas
  for (const answer of submission.answers) {
    const question = questionMap.get(answer.questionId);
    if (!question) continue;

    const option = question.options.find((opt) => opt.id === answer.optionId);
    if (!option) continue;

    for (const award of option.awards) {
      scores[award.style] += award.points;
    }

    contributions.push(
      Object.freeze({
        questionId: answer.questionId,
        optionId: answer.optionId,
        awards: Object.freeze([...option.awards]),
      })
    );
  }

  // Filtragem e ordenação determinística dos estilos com evidência estritamente positiva (> 0)
  const positiveStyles: { style: MarketingProStyle; score: number }[] = [];
  for (const style of [...QUIZ_STYLE_TIE_BREAK_ORDER].reverse()) {
    const score = scores[style];
    if (score > 0) {
      positiveStyles.push({ style, score });
    }
  }

  const tieBreakIndexMap = new Map<MarketingProStyle, number>();
  for (let idx = 0; idx < QUIZ_STYLE_TIE_BREAK_ORDER.length; idx += 1) {
    tieBreakIndexMap.set(QUIZ_STYLE_TIE_BREAK_ORDER[idx], idx);
  }

  const tieBreaksApplied: StyleQuizTieBreakEvent[] = [];

  // Mapear empates para auditoria do breakdown
  const scoreGroups = new Map<number, MarketingProStyle[]>();
  for (const item of positiveStyles) {
    const list = scoreGroups.get(item.score) ?? [];
    list.push(item.style);
    scoreGroups.set(item.score, list);
  }

  for (const [scoreVal, stylesInGroup] of Array.from(scoreGroups.entries())) {
    if (stylesInGroup.length > 1) {
      const sortedGroup = [...stylesInGroup].sort(
        (a, b) => (tieBreakIndexMap.get(a) ?? 0) - (tieBreakIndexMap.get(b) ?? 0)
      );
      tieBreaksApplied.push(
        Object.freeze({
          score: scoreVal,
          tiedStyles: Object.freeze(stylesInGroup),
          resolvedOrder: Object.freeze(sortedGroup),
        })
      );
    }
  }

  // Ordenação lexicográfica de ranking: 1. Maior score primeiro; 2. Desempate canônico pré-definido
  positiveStyles.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    const indexA = tieBreakIndexMap.get(a.style) ?? 0;
    const indexB = tieBreakIndexMap.get(b.style) ?? 0;
    return indexA - indexB;
  });

  const rankedStyles: MarketingProStyle[] = positiveStyles.map((item) => item.style);

  const profile: AdsProCreativeProfileV1 = Object.freeze({
    schemaVersion: ADS_PRO_CREATIVE_PROFILE_SCHEMA_VERSION,
    preferredStyles: Object.freeze(rankedStyles),
  });

  const breakdown: StyleQuizScoreBreakdown = Object.freeze({
    styleScores: Object.freeze({ ...scores }),
    rankedStyles: Object.freeze(rankedStyles),
    contributions: Object.freeze(contributions),
    tieBreaksApplied: Object.freeze(tieBreaksApplied),
  });

  return Object.freeze({
    profile,
    breakdown,
  });
}

/**
 * Função de conveniência que recebe a submissão do quiz e retorna diretamente
 * o AdsProCreativeProfileV1 canônico pronto para consumo pelo resolveAssetMatchContext.
 */
export function resolveCreativeProfileFromQuiz(
  submission: AdsProStyleQuizSubmission,
  definition: AdsProStyleQuizDefinition = ADS_PRO_STYLE_QUIZ_DEFINITION_V1
): AdsProCreativeProfileV1 {
  const result = evaluateStyleQuiz(submission, definition);
  return result.profile;
}

/**
 * Função de integração pura fim-a-fim entre a submissão do Quiz e o AssetMatchContext do Matcher.
 *
 * Garante que:
 * 1. O Quiz influencia EXCLUSIVAMENTE preferredStyles no contexto do Matcher.
 * 2. entityKind, format, category e intent de requestContext são preservados integralmente.
 */
export function resolveQuizAssetMatchContext(
  requestContext: AdCreationContext,
  submission: AdsProStyleQuizSubmission,
  definition: AdsProStyleQuizDefinition = ADS_PRO_STYLE_QUIZ_DEFINITION_V1
): AssetMatchContext {
  const profile = resolveCreativeProfileFromQuiz(submission, definition);
  return resolveAssetMatchContext(requestContext, profile);
}
