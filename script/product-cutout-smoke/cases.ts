/**
 * PRO-07F.3B-PREP — os 3 casos escolhidos por inspeção visual das amostras já existentes em
 * .tmp/product-image-quality-calibration-samples/. Nenhum arquivo foi movido/copiado.
 *
 * AVISO: este arquivo foi RECONSTRUÍDO em 2026-08-17 depois de uma colisão de escrita concorrente —
 * duas sessões de agente criaram, de forma independente e sem coordenação, um arquivo com este mesmo
 * nome neste mesmo diretório, e a escrita mais recente (a minha) sobrescreveu a original sem que eu
 * soubesse que ela existia. A reconstrução abaixo usa exatamente o contrato observado nos call sites
 * reais de ./cli.ts (campos `id`/`file`/`mimeType`, `getProductCutoutSmokeCase` devolvendo
 * `undefined` — não lançando — para um id desconhecido, `PRODUCT_CUTOUT_SMOKE_CASES` como array). Os
 * 3 casos em si (A/B/C) são os mesmos já entregues no PRO-07F.3B-PREP, então não são uma suposição.
 * O que É inferência: qualquer campo/comentário do arquivo original que não aparecesse em nenhum call
 * site observável. Recomendo confirmar com a sessão que criou a versão original antes de confiar
 * cegamente nisto para além de destravar o teste.
 */
import path from "node:path";

const SAMPLES_DIR = path.join(".tmp", "product-image-quality-calibration-samples");

export interface ProductCutoutSmokeCase {
  readonly id: string;
  readonly file: string;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
  readonly description: string;
}

export const PRODUCT_CUTOUT_SMOKE_CASES: readonly ProductCutoutSmokeCase[] = [
  {
    id: "A",
    file: path.join(SAMPLES_DIR, "WhatsApp Image 2026-08-16 at 16.35.07.jpeg"),
    mimeType: "image/jpeg",
    width: 1542,
    height: 2560,
    description: "embalagem plástica opaca simples (Casa & Perfume), fundo branco de estúdio",
  },
  {
    id: "B",
    file: path.join(SAMPLES_DIR, "WhatsApp Image 2026-08-16 at 16.29.58.jpeg"),
    mimeType: "image/jpeg",
    width: 1600,
    height: 1600,
    description: "frasco de perfume O Boticário Coffee Unique, vidro translúcido + tampa dourada refletiva",
  },
  {
    id: "C",
    file: path.join(SAMPLES_DIR, "WhatsApp Image 2026-08-16 at 16.32.41.jpeg"),
    mimeType: "image/jpeg",
    width: 1108,
    height: 1419,
    description: "tênis calçado, fundo externo visualmente complexo",
  },
];

export function getProductCutoutSmokeCase(id: string): ProductCutoutSmokeCase | undefined {
  return PRODUCT_CUTOUT_SMOKE_CASES.find((entry) => entry.id === id);
}
