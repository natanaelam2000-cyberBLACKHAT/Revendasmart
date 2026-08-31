/**
 * ADS-PRO-03 §16 — rótulos de família em português, para qualquer superfície que precise mostrar a
 * `CreativeFamily` de um anúncio Pro de forma legível (hoje: o card de histórico). Extraído para cá em
 * vez de duplicado, para as duas superfícies nunca divergirem.
 */
import type { CreativeConcept } from "@shared/marketing-pro-creative-intelligence";

export const MARKETING_PRO_CREATIVE_FAMILY_LABELS: Record<CreativeConcept["creativeFamily"], string> = {
  luxury: "Luxo",
  editorial: "Editorial",
  modern: "Moderno",
  minimal: "Minimalista",
  sensory: "Sensorial",
  "fresh-premium": "Fresh Premium",
  "fresh-sport": "Fresh Sport",
  "fresh-commercial": "Fresh Commercial",
};
