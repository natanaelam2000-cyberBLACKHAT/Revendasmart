/**
 * RELEASE-04 — helpers únicos de escaping para os dois vetores de export encontrados na auditoria:
 * Stored XSS em relatórios HTML (`document.write`) e CSV Formula Injection nos exports de planilha.
 * Nunca confiar em texto "já sanitizado" vindo da UI — todo dado dinâmico de loja/produto/cliente
 * passa por aqui antes de virar HTML ou CSV.
 */

/**
 * Escape de HTML TEXT CONTENT (nunca de atributo/URL/CSS — nenhum dos consumidores atuais insere
 * dado dinâmico em atributo/URL, então um único escaper de texto basta aqui). Cobre os 5 caracteres
 * que importam para texto HTML: & < > " '.
 */
export function escapeHtmlText(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const CSV_FORMULA_TRIGGER_CHARS = new Set(["=", "+", "-", "@", "\t", "\r"]);
const CSV_QUOTE_TRIGGER = /["\n\r,;]/;
// Valores que o próprio app formata (moeda/porcentagem/número em pt-BR) nunca podem virar comando ao
// abrir a planilha, mesmo começando com "-" (ex.: lucro negativo "-R$ 50,00") — evita prefixar à toa
// um dado numérico legítimo só porque ele começa com "-". Qualquer caractere fora de dígitos/./,/%/
// "R$" já falha este padrão e continua neutralizado normalmente.
const CSV_SAFE_NUMERIC_LIKE = /^-?\s*(R\$\s*)?[\d.,]+\s*%?$/;

/**
 * Neutraliza CSV Formula Injection (célula cujo primeiro caractere é =, +, -, @, tab ou CR) prefixando
 * com apóstrofo — a mitigação padrão (OWASP CSV Injection) — e aplica o quoting CSV normal por cima
 * (aspas quando a célula contém vírgula/ponto-e-vírgula/aspas/quebra de linha).
 */
export function escapeCsvCell(value: unknown): string {
  let text = String(value ?? "");
  if (text.length > 0 && CSV_FORMULA_TRIGGER_CHARS.has(text[0]) && !CSV_SAFE_NUMERIC_LIKE.test(text)) {
    text = `'${text}`;
  }
  if (CSV_QUOTE_TRIGGER.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** Monta uma linha CSV a partir de células soltas — cada célula passa por escapeCsvCell antes do join. */
export function toCsvRow(cells: readonly unknown[], delimiter: string = ","): string {
  return cells.map(escapeCsvCell).join(delimiter);
}
