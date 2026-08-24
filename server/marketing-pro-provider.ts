/**
 * Fronteira de provider de geração de imagem — PRO-06A / PRO-06B0.
 *
 * Esta interface é o ÚNICO ponto de contato entre o backend e um futuro fornecedor de IA. Trocar de
 * fornecedor (PRO-06B+) significa trocar a implementação por trás dela; nenhum outro módulo deve
 * conhecer o formato de request/response de um provider específico.
 *
 * Só existe `generateBackground` porque é só disso que a sprint precisa. `editBackground` e
 * `generateVariation` não têm consumidor ainda — criá-los agora seria interface futurista sem uso,
 * exatamente o que a auditoria pediu para evitar.
 *
 * INPUT (PRO-06B0): deixou de ser só `{style, format}` — agora é `MarketingProProviderArtDirection`
 * (shared), que também carrega categoria, paleta, iluminação, superfície, atmosfera e hints de safe
 * zone. Continua deliberadamente pobre do lado comercial: nome de produto, preço, CTA, descrição,
 * loja e a imagem do produto NUNCA atravessam esta fronteira — garantido por tipo em
 * shared/marketing-pro-contract.ts (`AssertNoForbiddenProviderFields`), não só por este comentário.
 *
 * OUTPUT: quando `status: "ready"`, o provider também devolve `output` — metadado técnico mínimo
 * (mimeType/width/height/byteSize) para o quality gate (server/marketing-pro-quality.ts) validar
 * ANTES de qualquer geração virar `ready` no documento persistido.
 *
 * `asset` (PRO-08): campo OPCIONAL e SEPARADO de `output` — só um provider REAL o preenche (o mock
 * determinístico nunca preenche, de propósito: ele nunca gerou bytes de verdade). Carrega os bytes
 * crus da imagem gerada, exclusivamente para o backend persistir como asset derivado
 * (`server/marketing-pro-background-persistence.ts`) — nunca é serializado de volta ao cliente, nunca
 * logado, nunca atravessa o quality gate (que continua vendo só `output`). Manter os dois campos
 * separados preserva o contrato original do quality gate (cego a bytes) e deixa explícito, por tipo,
 * que só a rota que efetivamente persiste um asset real precisa saber que `asset` existe.
 */

import { MARKETING_PRO_FORMAT_DIMENSIONS, type MarketingProProviderArtDirection } from "../shared/marketing-pro-contract";

/** Alias por clareza no call site: o input do provider É a direção de arte segura, nada além dela. */
export type MarketingProBackgroundInput = MarketingProProviderArtDirection;

export type MarketingProProviderErrorCode = "GENERATION_FAILED" | "GENERATION_TIMEOUT";

/** Metadado técnico da imagem gerada — não a imagem em si. Consumido pelo quality gate. */
export interface MarketingProProviderOutputMetadata {
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
  readonly byteSize: number;
}

/** Bytes reais de um provider REAL — nunca preenchido pelo mock. Ver comentário de `asset` acima. */
export interface MarketingProProviderGeneratedAsset {
  readonly mimeType: string;
  readonly bytes: Buffer;
}

export type MarketingProBackgroundResult =
  | { readonly status: "ready"; readonly output: MarketingProProviderOutputMetadata; readonly asset?: MarketingProProviderGeneratedAsset }
  | { readonly status: "failed"; readonly errorCode: MarketingProProviderErrorCode };

export interface MarketingImageProvider {
  /** Identificador curto (ex.: "google") — só usado para metadado de persistência (PRO-08), nunca no prompt. */
  readonly id?: string;
  /** Nome do modelo (ex.: "gemini-3.1-flash-image") — mesmo uso que `id`. */
  readonly model?: string;
  generateBackground(input: MarketingProBackgroundInput): Promise<MarketingProBackgroundResult>;
}

/**
 * Provider mock determinístico: sem rede, sem IA, sem imagem real. Sempre resolve com sucesso e
 * devolve metadado plausível (PNG, dimensão exata do formato pedido) — existe para provar o CONTRATO
 * ponta a ponta (pipeline aceita → processa → valida qualidade → conclui), não para simular falhas
 * por conta própria. Testes que precisam de failure/timeout/output inválido injetam seu próprio
 * `MarketingImageProvider` (ver registerMarketingProRoutes), sem precisar alterar este mock.
 */
export function createDeterministicMockProvider(): MarketingImageProvider {
  return {
    async generateBackground(input: MarketingProBackgroundInput): Promise<MarketingProBackgroundResult> {
      const dimensions = MARKETING_PRO_FORMAT_DIMENSIONS[input.format];
      return {
        status: "ready",
        output: { mimeType: "image/png", width: dimensions.width, height: dimensions.height, byteSize: 250_000 },
      };
    },
  };
}
