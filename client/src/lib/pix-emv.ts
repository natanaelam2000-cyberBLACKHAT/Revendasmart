/**
 * Gerador local de payload Pix EMV/BR Code (copia-e-cola + QR estático), conforme o Manual de Padrões
 * para Iniciação do Pix do Banco Central. Função pura, sem chamada de rede: monta o texto a partir da
 * chave Pix já cadastrada pelo lojista, nunca inventa nem valida a chave — só formata.
 *
 * Referência do formato: EMV QR Code Especificação para Pagamentos (EMVCo) + Anexo I do Pix.
 */

const GUI_PIX = "br.gov.bcb.pix";
const CRC16_POLYNOMIAL = 0x1021;
const CRC16_INITIAL = 0xffff;

/** Remove acentos/diacríticos e caracteres fora de ASCII imprimível — exigência do padrão EMV/Pix. */
function toAsciiUpper(value: string): string {
  // NFD separa acento de letra em dois code points (ex.: "é" → "e" + combining acute); o segundo replace
  // descarta qualquer code point fora do ASCII imprimível, o que já cobre os acentos separados.
  return value
    .normalize("NFD")
    .replace(/[^\x20-\x7e]/g, "")
    .toUpperCase()
    .trim();
}

function truncate(value: string, maxLength: number): string {
  return value.slice(0, maxLength);
}

/** Campo TLV: ID (2 dígitos) + tamanho do VALOR em bytes (2 dígitos) + VALOR. */
function tlv(id: string, value: string): string {
  const length = value.length.toString().padStart(2, "0");
  return `${id}${length}${value}`;
}

/**
 * Exportado só para teste direto contra o vetor de referência público do CRC-16/CCITT-FALSE
 * ("123456789" -> 0x29B1) — os mesmos parâmetros (poly 0x1021, init 0xFFFF, sem reflexão/xorout) que
 * o padrão EMV/Pix exige. Não é usado fora deste módulo em produção.
 */
export function crc16Ccitt(payload: string): string {
  let crc = CRC16_INITIAL;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ CRC16_POLYNOMIAL) : (crc << 1);
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

export interface PixEmvInput {
  /** Chave Pix já cadastrada pelo lojista (CPF/CNPJ/e-mail/telefone/aleatória) — usada como está. */
  pixKey: string;
  /** Nome do recebedor exibido no app bancário do pagador. Máx. 25 caracteres pelo padrão. */
  merchantName: string;
  /** Cidade do recebedor. Máx. 15 caracteres pelo padrão. */
  merchantCity: string;
  /** Valor do pedido em reais (ex.: 129.9). Omitir gera um Pix sem valor fixo. */
  amount?: number;
  /** Identificador da transação (txid) — usado para conciliar; "***" é o valor coringa do padrão. */
  txId?: string;
}

/**
 * Monta o payload EMV/BR Code pronto para virar QR Code (ex.: via `qrcode.react`) ou ser copiado como
 * "Pix copia e cola". Nunca lança por chave/nome/cidade vazios — usa fallbacks seguros, porque um erro
 * aqui bloquearia o fechamento do pedido só por causa de um cadastro incompleto do lojista.
 */
export function buildPixEmvPayload(input: PixEmvInput): string {
  const pixKey = input.pixKey.trim();
  const merchantName = truncate(toAsciiUpper(input.merchantName) || "LOJA", 25);
  const merchantCity = truncate(toAsciiUpper(input.merchantCity) || "BRASIL", 15);
  const txId = truncate((input.txId?.trim() || "***").replace(/[^A-Za-z0-9*]/g, ""), 25) || "***";

  const merchantAccountInfo = tlv("00", GUI_PIX) + tlv("01", truncate(pixKey, 77));
  const additionalData = tlv("05", txId);

  const amountValue = typeof input.amount === "number" && input.amount > 0
    ? input.amount.toFixed(2)
    : undefined;

  const payloadWithoutCrc = [
    tlv("00", "01"),
    tlv("26", merchantAccountInfo),
    tlv("52", "0000"),
    tlv("53", "986"),
    ...(amountValue ? [tlv("54", amountValue)] : []),
    tlv("58", "BR"),
    tlv("59", merchantName),
    tlv("60", merchantCity),
    tlv("62", additionalData),
  ].join("") + "6304";

  return payloadWithoutCrc + crc16Ccitt(payloadWithoutCrc);
}
