/**
 * GEOMETRIA CANÔNICA DA ARTE DO ANÚNCIO — fonte única de verdade.
 *
 * O Preview (DOM/CSS) e o PNG exportado (Canvas 2D) são renderizadores diferentes: um usa React, o
 * outro desenha imperativamente. Enquanto cada um carregava seus próprios números, os dois layouts
 * divergiam na prática — a caixa da foto ocupava 53% do card no Preview e apenas 38% no PNG, e era
 * por isso que o produto "encolhia" ao compartilhar no WhatsApp.
 *
 * Aqui as medidas vivem UMA vez, em fração do lado do quadrado. Os dois renderizadores multiplicam
 * pelo próprio tamanho (1080 no PNG, a largura do container no Preview), então mudar uma proporção
 * move as duas saídas juntas e elas não têm como se separar de novo.
 *
 * Módulo puro: sem React, sem canvas, sem DOM.
 */

/** Lado da arte exportada, em pixels. A arte é sempre quadrada e independe da tela do aparelho. */
export const ART_SIZE = 1080;

/** Converte fração do lado em pixels da arte final. */
export const toArtPx = (fraction: number, size: number = ART_SIZE): number => Math.round(fraction * size);

/** Converte fração em porcentagem CSS, para o Preview escalar sozinho. */
export const toArtPercent = (fraction: number): string => `${(fraction * 100).toFixed(4)}%`;

/**
 * Todas as medidas em fração do lado (0..1).
 *
 * A caixa da foto cresceu de 530x744 para 584x800 — de 38,5% para 45,3% da área do card. Com
 * `contain`, o produto desenhado é limitado pelo lado mais apertado da caixa, então alargar E
 * alongar faz TODO tipo de foto crescer junto: perfume alto vai de 427x712 para 463x772, retrato de
 * 498x685 para 556x765, quadrado de 498x498 para 556x556. Foto larga continua sendo o pior caso do
 * `contain` (sobra faixa em cima e embaixo), mas recortá-la seria alterar a imagem do produto — o
 * que está explicitamente fora de escopo.
 */
export const ART_LAYOUT = {
  /** Card branco interno, recuado da borda do quadrado. */
  card: { inset: 32 / 1080, radius: 54 / 1080 },

  /** Cabeçalho: logo, nome da loja e selo. */
  header: {
    logo: { x: 64 / 1080, y: 64 / 1080, size: 76 / 1080, radius: 22 / 1080, imageInset: 12 / 1080 },
    storeName: { x: 158 / 1080, y: 102 / 1080, width: 420 / 1080, fontSize: 32 / 1080 },
    storeTag: { x: 160 / 1080, y: 132 / 1080, fontSize: 15 / 1080 },
    /**
     * Selo ancorado no CANTO SUPERIOR DIREITO e alinhado ao cabeçalho.
     *
     * A versão anterior fixava a largura em 192px e a posição em x=792. Duas consequências: o selo
     * parava a 64px da borda do card enquanto o logo começava a 32px — visualmente ele flutuava para
     * o meio em vez de ocupar o canto —, e "OFERTA ESPECIAL" a 21px é mais largo que 192px, então o
     * texto vazava para fora da pílula e lia como um segundo carimbo solto.
     *
     * Agora a âncora é a borda direita (mesma margem de 32px do logo), o centro vertical é o mesmo do
     * logo, e a largura é calculada a partir do texto — a pílula acompanha o rótulo do template.
     */
    badge: {
      rightX: 1016 / 1080,
      /** Mesmo centro vertical do logo da loja — é isso que alinha o selo ao cabeçalho. */
      centerY: 102 / 1080,
      /** 52 mantém o selo terminando em y=128, ainda com folga até a caixa da foto (y=132). */
      height: 52 / 1080,
      radius: 26 / 1080,
      /** Corpo ideal do selo; cai sozinho quando o rótulo do template for longo demais. */
      fontSizeMax: 30 / 1080,
      fontSizeMin: 20 / 1080,
      paddingX: 34 / 1080,
      minWidth: 168 / 1080,
      /** 404 ainda deixa o selo terminando bem à direita da coluna de texto (1016-404=612 > 416). */
      maxWidth: 404 / 1080,
      maxLabelLength: 22,
    },
  },

  /** Coluna de texto à esquerda. */
  text: {
    x: 60 / 1080,
    width: 356 / 1080,
    /**
     * Chamada comercial do template ("OFERTA IMPERDÍVEL!", "LANÇAMENTO"...). Ganhou corpo, mas o
     * tamanho é ajustado à coluna: a 22px fixos, rótulos longos como "O QUERIDINHO DAS CLIENTES!"
     * (378px) já não cabiam nos 356px da coluna e o desenho DESCARTAVA as palavras que sobravam.
     */
    /**
     * O TETO REAL da chamada é a coluna, não este número: "OFERTA IMPERDÍVEL!" mede 359px a 30px
     * contra 349px úteis, então ela se estabiliza em 28 por mais alto que o teto seja. 32 dá folga
     * para rótulos curtos sem fingir um ganho que a largura da coluna não permite.
     */
    headline: {
      y: 214 / 1080,
      fontSizeMax: 32 / 1080,
      fontSizeMin: 22 / 1080,
      lineHeight: 38 / 1080,
      /**
       * Traço curto de destaque ABAIXO da chamada.
       *
       * Foi escolhido em vez de uma barra à esquerda porque não custa nada da largura: a chamada já
       * está no limite da coluna (28px é o maior corpo em que "OFERTA IMPERDÍVEL!" cabe), então
       * qualquer elemento ao lado do texto roubaria espaço e a obrigaria a encolher. Abaixo, ele
       * ocupa a folga vertical que já existia entre a chamada (base ~221) e o nome (topo ~247).
       *
       * Também é o que diferencia a chamada do selo: um é traço, o outro é cápsula.
       */
      accentBar: { width: 64 / 1080, height: 6 / 1080, radius: 3 / 1080, offsetY: 16 / 1080 },
    },
    /** Nome maior que antes; encolhe sozinho se precisar, mas nunca abaixo do mínimo legível. */
    name: {
      y: 292 / 1080,
      lineHeight: 60 / 1080,
      maxLines: 2,
      fontSizeMax: 62 / 1080,
      fontSizeLong: 50 / 1080,
      fontSizeMin: 36 / 1080,
      /** Acima deste tamanho de texto já começa no corpo menor, para caber em 2 linhas. */
      longNameLength: 42,
    },
    description: { fontSize: 22 / 1080, lineHeight: 30 / 1080, maxLines: 2, gap: 18 / 1080, blockHeight: 66 / 1080 },
    /** Preço com bastante presença — é a informação que decide a compra. */
    price: { fontSize: 76 / 1080, offsetY: 86 / 1080 },
    /**
     * Linha de atributos: ícone circular + texto.
     *
     * `textX` NÃO é mais um número solto ao lado de `iconX` — ele é derivado de
     * `iconX + iconRadius + gap` (ver getArtAttributeTextX). Dois valores independentes podiam
     * divergir em silêncio; derivado, o afastamento entre ícone e texto é estrutural.
     */
    attributes: { offsetY: 150 / 1080, rowHeight: 54 / 1080, iconRadius: 21 / 1080, iconX: 81 / 1080, gap: 20 / 1080, fontSize: 24 / 1080 },
    /**
     * CTA alinhado à coluna de texto. O corpo também é ajustado à largura: a 28px fixos e com 30px
     * de respiro interno, "Chamar no WhatsApp" (329px) não cabia nos 326px úteis e o desenho
     * publicava só "Chamar no" no PNG compartilhado.
     */
    cta: { y: 872 / 1080, height: 104 / 1080, radius: 32 / 1080, fontSizeMax: 34 / 1080, fontSizeMin: 24 / 1080, paddingX: 8 / 1080 },
  },

  /**
   * Caixa da foto — posição e tamanho externos APROVADOS, não mexer.
   *
   * `insetX`/`insetY` são a folga interna entre a moldura e a imagem desenhada; são o único
   * parâmetro que faz o produto crescer sem tocar na caixa. Como o produto é limitado pela altura
   * (contain), a folga vertical é a que mais importa e por isso é menor que a horizontal.
   */
  photo: { x: 440 / 1080, y: 132 / 1080, width: 584 / 1080, height: 800 / 1080, radius: 44 / 1080, insetX: 8 / 1080, insetY: 4 / 1080 },

  /** Assinatura discreta no rodapé. */
  signature: { textRightX: 1016 / 1080, y: 978 / 1080, fontSize: 16 / 1080, logoX: 764 / 1080, logoY: 960 / 1080, logoSize: 30 / 1080 },
} as const;

/**
 * Larguras das duas colunas, em fração do lado da arte.
 *
 * Substitui a proporção em `fr` que o Preview usava. As frações da coluna sobre o card somavam
 * 0,9252 e, pela regra do CSS, um grid cujas trilhas somam menos de 1fr recebe apenas ESSA fração do
 * espaço livre — o restante fica sem dono. Era daí que saíam 331,9 em vez de 356 e 544,5 em vez de
 * 584: o grid entregava 92,5% do espaço e abandonava 70,9 unidades à direita.
 *
 * Largura declarada elimina a classe inteira do problema: a coluna vale o que o contrato diz.
 */
export function getArtColumnWidths(): { text: number; photo: number } {
  return { text: ART_LAYOUT.text.width, photo: ART_LAYOUT.photo.width };
}

/**
 * Vão entre a coluna de texto e a caixa da foto. Era um valor implícito — existia como a distância
 * entre dois pontos do contrato, sem nunca ser nomeado; o CSS carregava um `gap` próprio (15,4) que
 * não correspondia a ele.
 */
export function getArtColumnGap(): number {
  return ART_LAYOUT.photo.x - (ART_LAYOUT.text.x + ART_LAYOUT.text.width);
}

/**
 * Recuo interno do card até as colunas — o outro valor que estava implícito no contrato, e que é
 * ASSIMÉTRICO: 28 à esquerda (borda do card em 32, texto começa em 60) e 24 à direita (foto termina
 * em 1024, card termina em 1048). Um `padding` simétrico nunca reproduziria os dois.
 */
export function getArtCardPadding(): { left: number; right: number } {
  const cardRight = 1 - ART_LAYOUT.card.inset;
  return {
    left: ART_LAYOUT.text.x - ART_LAYOUT.card.inset,
    right: cardRight - (ART_LAYOUT.photo.x + ART_LAYOUT.photo.width),
  };
}

/** Proporção largura/altura da caixa da foto — usada pelo Preview via `aspect-ratio`. */
export function getPhotoBoxAspectRatio(): number {
  return ART_LAYOUT.photo.width / ART_LAYOUT.photo.height;
}

/**
 * Família usada no texto da arte exportada. Fica aqui porque a REGRA de ajuste do preço precisa
 * medir com a mesma fonte nos dois renderizadores — se cada um medisse com a sua, o Preview e o PNG
 * escolheriam tamanhos diferentes para o mesmo preço.
 */
export const ART_FONT_FAMILY = "Arial";

/**
 * Ajuste do preço à coluna de texto.
 *
 * O preço era desenhado num tamanho fixo (76px sobre 1080) e a coluna tem 356px. Medido com
 * `measureText` em Arial 900: só "R$ 9,90" cabia — "R$ 55,00" já pedia 363px e "R$ 1.299,90"
 * chegava a 490px, invadindo a caixa da foto. Não era um problema de "preço com 4 dígitos": o
 * estouro começava com dois.
 *
 * `safety` desconta uma margem da largura disponível. O PNG mede na fonte que ele mesmo desenha,
 * mas o Preview renderiza na fonte do app; medir com uma folga evita que uma diferença de métrica
 * entre as duas famílias faça o texto encostar na borda da coluna.
 */
export const ART_PRICE_FIT = {
  /** Tamanho ideal: só é reduzido quando o preço realmente não couber. */
  maxFontSize: 76 / 1080,
  /** Piso legível — continua bem acima da descrição (22) e dos atributos (24). */
  minFontSize: 44 / 1080,
  stepPx: 2,
  safety: 0.98,
} as const;

/**
 * Maior tamanho de fonte, dentro do intervalo, em que o texto cabe na largura pedida.
 *
 * Determinístico e mensurável: desce de `maxFontSizePx` até `minFontSizePx` em passos fixos e
 * devolve o primeiro que couber segundo a função `measure` de quem chamou — não há heurística por
 * contagem de caracteres. Quem chama fornece a medição real do seu renderizador.
 */
export function fitArtTextFontSize(options: {
  text: string;
  maxWidthPx: number;
  maxFontSizePx: number;
  minFontSizePx: number;
  stepPx?: number;
  measure: (text: string, fontSizePx: number) => number;
}): number {
  const step = Math.max(1, Math.round(options.stepPx ?? 2));
  const min = Math.min(options.minFontSizePx, options.maxFontSizePx);
  for (let fontSize = options.maxFontSizePx; fontSize > min; fontSize -= step) {
    if (options.measure(options.text, fontSize) <= options.maxWidthPx) return fontSize;
  }
  return min;
}

/**
 * Tamanho do preço na arte — a REGRA única que Preview e PNG compartilham. `size` permite calcular
 * na dimensão lógica (1080) mesmo quando o Preview está desenhado menor na tela.
 */
export function getArtPriceFontSize(
  priceText: string,
  measure: (text: string, fontSizePx: number) => number,
  size: number = ART_SIZE,
): number {
  return fitArtTextFontSize({
    text: priceText,
    maxWidthPx: toArtPx(ART_LAYOUT.text.width, size) * ART_PRICE_FIT.safety,
    maxFontSizePx: toArtPx(ART_PRICE_FIT.maxFontSize, size),
    minFontSizePx: toArtPx(ART_PRICE_FIT.minFontSize, size),
    stepPx: Math.max(1, Math.round((ART_PRICE_FIT.stepPx * size) / ART_SIZE)),
    measure,
  });
}

/** Corpo da chamada comercial do template, ajustado à coluna de texto. */
export function getArtHeadlineFontSize(
  headline: string,
  measure: (text: string, fontSizePx: number) => number,
  size: number = ART_SIZE,
): number {
  return fitArtTextFontSize({
    text: headline,
    maxWidthPx: toArtPx(ART_LAYOUT.text.width, size) * ART_PRICE_FIT.safety,
    maxFontSizePx: toArtPx(ART_LAYOUT.text.headline.fontSizeMax, size),
    minFontSizePx: toArtPx(ART_LAYOUT.text.headline.fontSizeMin, size),
    stepPx: Math.max(1, Math.round((2 * size) / ART_SIZE)),
    measure,
  });
}

/** Corpo do CTA, ajustado à largura útil do botão (largura da coluna menos o respiro interno). */
export function getArtCtaFontSize(
  ctaText: string,
  measure: (text: string, fontSizePx: number) => number,
  size: number = ART_SIZE,
): number {
  const usableWidth = toArtPx(ART_LAYOUT.text.width, size) - toArtPx(ART_LAYOUT.text.cta.paddingX, size) * 2;
  return fitArtTextFontSize({
    text: ctaText,
    maxWidthPx: usableWidth * ART_PRICE_FIT.safety,
    maxFontSizePx: toArtPx(ART_LAYOUT.text.cta.fontSizeMax, size),
    minFontSizePx: toArtPx(ART_LAYOUT.text.cta.fontSizeMin, size),
    stepPx: Math.max(1, Math.round((2 * size) / ART_SIZE)),
    measure,
  });
}

/** Rótulo do selo já recortado no limite do contrato — o conteúdo continua vindo do template. */
export function getArtBadgeLabel(badgeText: string): string {
  return badgeText.toUpperCase().slice(0, ART_LAYOUT.header.badge.maxLabelLength);
}

/** Corpo do selo, ajustado para o rótulo caber DENTRO da pílula em vez de vazar por cima dela. */
export function getArtBadgeFontSize(
  label: string,
  measure: (text: string, fontSizePx: number) => number,
  size: number = ART_SIZE,
): number {
  const badge = ART_LAYOUT.header.badge;
  const usableWidth = toArtPx(badge.maxWidth, size) - toArtPx(badge.paddingX, size) * 2;
  return fitArtTextFontSize({
    text: label,
    maxWidthPx: usableWidth,
    maxFontSizePx: toArtPx(badge.fontSizeMax, size),
    minFontSizePx: toArtPx(badge.fontSizeMin, size),
    stepPx: Math.max(1, Math.round((2 * size) / ART_SIZE)),
    measure,
  });
}

/**
 * Largura da pílula do selo: acompanha o rótulo, entre o mínimo e o máximo do contrato.
 *
 * `ceil` e não `round`: arredondar para baixo devolvia uma pílula fracionalmente mais estreita que o
 * texto que ela precisa conter, o que deixava o invariante "o rótulo cabe dentro do selo" falhando
 * por décimos de pixel.
 */
export function getArtBadgeWidth(labelWidthPx: number, size: number = ART_SIZE): number {
  const badge = ART_LAYOUT.header.badge;
  return Math.min(
    toArtPx(badge.maxWidth, size),
    Math.max(toArtPx(badge.minWidth, size), Math.ceil(labelWidthPx) + toArtPx(badge.paddingX, size) * 2),
  );
}

/**
 * Sombra discreta usada nos dois elementos que precisam se destacar do card branco (selo e CTA).
 * Fica no contrato para que Preview e PNG apliquem a MESMA separação, e não duas interpretações.
 */
export const ART_ELEVATION = {
  badge: { blur: 14 / 1080, offsetY: 4 / 1080, color: "rgba(15,23,42,.22)" },
  cta: { blur: 22 / 1080, offsetY: 8 / 1080, color: "rgba(15,23,42,.26)" },
} as const;

/**
 * Cor de tinta legível sobre um fundo qualquer.
 *
 * O contraste do selo e do CTA não pode depender de UMA cor de tema: a loja escolhe o acento, e
 * temas claros (laranja, verde) pedem tinta escura enquanto temas fortes pedem tinta branca. A
 * decisão sai da luminância relativa do próprio fundo — igual nos dois renderizadores.
 */
export function getArtInkColor(backgroundColor: string): string {
  const hex = String(backgroundColor).trim().replace(/^#/, "");
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return "#ffffff";
  const channel = (start: number) => {
    const value = Number.parseInt(full.slice(start, start + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  return luminance > 0.45 ? "#0f172a" : "#ffffff";
}

/** Luminância relativa (WCAG) de uma cor hexadecimal; -1 quando o valor não é uma cor válida. */
function relativeLuminance(hex: string): number {
  const clean = String(hex).trim().replace(/^#/, "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return -1;
  const channel = (start: number) => {
    const value = Number.parseInt(full.slice(start, start + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/**
 * Acento legível sobre o card claro da arte.
 *
 * A chamada usa a cor de destaque escolhida pela loja, mas o card é claro: um acento muito claro
 * (amarelo, turquesa) ficaria ilegível. Em vez de manter uma segunda lista de cores, a versão
 * legível é DERIVADA — a cor é escurecida em passos até passar no contraste de texto grande (3:1
 * sobre branco, ou seja luminância <= 0,30). Acentos que já passam voltam intactos.
 */
export function getArtReadableAccent(accentColor: string): string {
  const clean = String(accentColor).trim().replace(/^#/, "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return "#0f172a";
  let channels = [0, 2, 4].map((start) => Number.parseInt(full.slice(start, start + 2), 16));
  const target = [15, 23, 42];
  for (let step = 0; step < 8; step += 1) {
    const hex = `#${channels.map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
    if (relativeLuminance(hex) <= 0.3) return hex;
    channels = channels.map((value, index) => value + (target[index] - value) * 0.18);
  }
  return "#0f172a";
}

/** Início do texto do atributo: sempre depois do limite direito do ícone mais o afastamento. */
export function getArtAttributeTextX(): number {
  const attr = ART_LAYOUT.text.attributes;
  return attr.iconX + attr.iconRadius + attr.gap;
}

/** Largura restante para o texto do atributo até o fim da coluna. */
export function getArtAttributeTextWidth(): number {
  return ART_LAYOUT.text.x + ART_LAYOUT.text.width - getArtAttributeTextX();
}

/** Área interna da caixa da foto — é aqui que o produto é desenhado, em fração do lado. */
export function getArtPhotoInnerBox(): { x: number; y: number; width: number; height: number } {
  const photo = ART_LAYOUT.photo;
  return {
    x: photo.x + photo.insetX,
    y: photo.y + photo.insetY,
    width: photo.width - photo.insetX * 2,
    height: photo.height - photo.insetY * 2,
  };
}

/**
 * Tamanho desenhado do produto depois do `contain`, em fração do lado. A caixa externa é fixa, então
 * este é o número que prova se o produto cresceu — e o teto do que é possível sem cortar a imagem.
 */
export function getArtProductDrawnSize(imageWidth: number, imageHeight: number): { width: number; height: number } {
  if (!(imageWidth > 0) || !(imageHeight > 0)) return { width: 0, height: 0 };
  const box = getArtPhotoInnerBox();
  const scale = Math.min(box.width / imageWidth, box.height / imageHeight);
  return { width: imageWidth * scale, height: imageHeight * scale };
}

/**
 * Fração da caixa que uma imagem realmente ocupa depois do `contain`. Serve aos testes: é a métrica
 * que prova que o produto ficou dominante em vez de perdido no meio do branco.
 */
export function getPhotoFillRatio(imageWidth: number, imageHeight: number): number {
  if (!(imageWidth > 0) || !(imageHeight > 0)) return 0;
  const box = getArtPhotoInnerBox();
  const drawn = getArtProductDrawnSize(imageWidth, imageHeight);
  return (drawn.width * drawn.height) / (box.width * box.height);
}
