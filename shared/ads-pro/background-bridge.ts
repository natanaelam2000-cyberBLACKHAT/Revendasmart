/**
 * ADS-PRO-03E2 — Ponte de Resolução entre AssetDNA e Background Visual
 *
 * Responsável por conectar a seleção algorítmica do Matcher (AssetDNA / AssetMatchResult)
 * ao cenário visual real (MarketingProBackgroundAsset) e gerar o Data URI / source
 * compatível com o compositor existente.
 */

import type { AssetDNA, AssetFormat } from "./asset-dna";
import type { AssetMatchResult } from "./asset-matcher";
import type { MarketingProBackgroundAsset } from "../marketing-pro-background-library";
import {
  MARKETING_PRO_BACKGROUND_LIBRARY,
  renderMarketingProBackgroundSource,
} from "../marketing-pro-background-library";

/**
 * Erro lançado quando um AssetDNA faz referência a um ID não cadastrado
 * na biblioteca canônica de backgrounds.
 */
export class BackgroundNotFoundError extends Error {
  constructor(assetId: string) {
    super(`Background não encontrado na biblioteca canônica para o asset ID: "${assetId}"`);
    this.name = "BackgroundNotFoundError";
  }
}

/**
 * Erro lançado quando o formato solicitado não é suportado pelo asset.
 */
export class UnsupportedAssetFormatError extends Error {
  constructor(assetId: string, format: string, supportedFormats: readonly string[]) {
    super(
      `Formato "${format}" não é suportado pelo asset "${assetId}". Formatos suportados: [${supportedFormats.join(", ")}]`
    );
    this.name = "UnsupportedAssetFormatError";
  }
}

/**
 * Localiza o background canônico correspondente a um AssetDNA via ID estável.
 *
 * @param asset AssetDNA selecionado pelo Matcher ou caller.
 * @returns Background canônico de produção.
 * @throws BackgroundNotFoundError se o ID não existir na biblioteca.
 */
export function resolveBackgroundForAsset(asset: AssetDNA): MarketingProBackgroundAsset {
  const bg = MARKETING_PRO_BACKGROUND_LIBRARY.find((item) => item.id === asset.id);
  if (!bg) {
    throw new BackgroundNotFoundError(asset.id);
  }
  return bg;
}

/**
 * Renderiza o source visual (Data URI SVG) para um AssetDNA no formato especificado.
 *
 * Valida estritamente:
 * 1. Se o formato solicitado é suportado pelo asset.
 * 2. Se o background correspondente existe na biblioteca canônica.
 *
 * @param asset AssetDNA selecionado.
 * @param format Formato solicitado para renderização (portrait, square, story).
 * @returns Data URI SVG compatível com o compositor de imagem.
 * @throws UnsupportedAssetFormatError se o asset não declarar suporte ao formato.
 * @throws BackgroundNotFoundError se o ID do asset não existir na biblioteca.
 */
export function renderAssetBackgroundSource(asset: AssetDNA, format: AssetFormat): string {
  if (!asset.formats.includes(format)) {
    throw new UnsupportedAssetFormatError(asset.id, format, asset.formats);
  }

  const bg = resolveBackgroundForAsset(asset);
  return renderMarketingProBackgroundSource(bg, format);
}

/**
 * Helper de conveniência para renderizar o background diretamente a partir do
 * resultado individual do Matcher (AssetMatchResult).
 *
 * @param result Resultado de matching contendo o asset vencedor.
 * @param format Formato desejado para a geração do anúncio.
 * @returns Data URI SVG do cenário.
 */
export function renderMatchResultBackgroundSource(
  result: AssetMatchResult,
  format: AssetFormat
): string {
  return renderAssetBackgroundSource(result.asset, format);
}
