import type {
  FinancialSummary,
  ReportComparisons,
  ReportIndicators,
  ReportRankings,
} from "@/lib/report-metrics";

export interface ReportExportPayload {
  storeName: string;
  periodLabel: string;
  generatedAt: Date;
  summary: FinancialSummary;
  rankings: ReportRankings;
  comparisons: ReportComparisons;
  indicators: ReportIndicators;
}

const currency = (value: number) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const number = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

function escapeCsv(value: string | number): string {
  const text = String(value ?? "");
  if (/[",\n\r;]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function downloadTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function metricRows(payload: ReportExportPayload): Array<[string, string]> {
  return [
    ["Receita hoje", currency(payload.summary.today.revenue)],
    ["Receita semana", currency(payload.summary.week.revenue)],
    ["Receita mês", currency(payload.summary.month.revenue)],
    ["Receita ano", currency(payload.summary.year.revenue)],
    ["Lucro hoje", currency(payload.summary.today.profit)],
    ["Lucro semana", currency(payload.summary.week.profit)],
    ["Lucro mês", currency(payload.summary.month.profit)],
    ["Lucro ano", currency(payload.summary.year.profit)],
    ["Ticket médio", currency(payload.summary.averageTicket)],
    ["Clientes ativos", String(payload.summary.activeClients)],
    ["Produtos vendidos", number(payload.summary.totalProductsSold)],
    ["Margem média", `${payload.indicators.averageMargin}%`],
  ];
}

function rankingTable(title: string, rows: ReportExportPayload["rankings"]["topSellingProducts"]) {
  const body = rows.length > 0
    ? rows.map((item, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${item.label}</td>
        <td>${number(item.quantity)}</td>
        <td>${currency(item.revenue)}</td>
        <td>${currency(item.profit)}</td>
      </tr>
    `).join("")
    : `<tr><td colspan="5">Sem dados suficientes.</td></tr>`;

  return `
    <section>
      <h2>${title}</h2>
      <table>
        <thead><tr><th>#</th><th>Nome</th><th>Qtd.</th><th>Receita</th><th>Lucro</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </section>
  `;
}

function buildPrintableHtml(payload: ReportExportPayload): string {
  const generatedAt = payload.generatedAt.toLocaleString("pt-BR");
  const rows = metricRows(payload).map(([label, value]) => `<tr><td>${label}</td><td>${value}</td></tr>`).join("");
  return `<!doctype html>
  <html lang="pt-BR">
    <head>
      <meta charset="utf-8" />
      <title>Relatório RevendaSmart</title>
      <style>
        * { box-sizing: border-box; }
        body { font-family: Inter, Arial, sans-serif; color: #1f2937; margin: 32px; }
        header { border-bottom: 2px solid #ec4899; padding-bottom: 18px; margin-bottom: 24px; }
        h1 { margin: 0; font-size: 28px; }
        h2 { margin: 24px 0 12px; font-size: 18px; color: #be5363; }
        p { margin: 4px 0; color: #6b7280; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 18px; }
        th, td { border: 1px solid #e5e7eb; padding: 10px; text-align: left; font-size: 12px; }
        th { background: #fdf2f8; color: #9f1239; text-transform: uppercase; font-size: 10px; letter-spacing: .08em; }
        .summary { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .card { border: 1px solid #e5e7eb; border-radius: 16px; padding: 14px; }
        @media print { body { margin: 18mm; } button { display: none; } }
      </style>
    </head>
    <body>
      <header>
        <h1>${payload.storeName}</h1>
        <p>Relatório executivo RevendaSmart</p>
        <p>Período: ${payload.periodLabel} · Gerado em ${generatedAt}</p>
      </header>
      <section>
        <h2>Resumo financeiro</h2>
        <table><tbody>${rows}</tbody></table>
      </section>
      ${rankingTable("Produtos mais vendidos", payload.rankings.topSellingProducts)}
      ${rankingTable("Produtos mais lucrativos", payload.rankings.mostProfitableProducts)}
      ${rankingTable("Clientes que mais gastaram", payload.rankings.clientsByRevenue)}
      <section>
        <h2>Indicadores</h2>
        <table>
          <tbody>
            <tr><td>Quantidade média por venda</td><td>${number(payload.indicators.averageQuantityPerSale)}</td></tr>
            <tr><td>Valor médio do estoque</td><td>${currency(payload.indicators.averageInventoryValue)}</td></tr>
            <tr><td>Produtos sem giro</td><td>${payload.indicators.productsWithoutTurnover.length}</td></tr>
            <tr><td>Produtos críticos</td><td>${payload.indicators.criticalProducts.length}</td></tr>
          </tbody>
        </table>
      </section>
    </body>
  </html>`;
}

function openPrintableWindow(payload: ReportExportPayload, shouldPrint: boolean) {
  const printable = window.open("", "_blank", "noopener,noreferrer,width=1024,height=768");
  if (!printable) return false;
  printable.document.open();
  printable.document.write(buildPrintableHtml(payload));
  printable.document.close();
  if (shouldPrint) {
    printable.focus();
    window.setTimeout(() => printable.print(), 300);
  }
  return true;
}

export function exportReportToPdf(payload: ReportExportPayload): boolean {
  return openPrintableWindow(payload, true);
}

export function printReport(payload: ReportExportPayload): boolean {
  return openPrintableWindow(payload, true);
}

export function exportReportToExcel(payload: ReportExportPayload): void {
  const lines: string[] = [];
  lines.push(["RevendaSmart - Relatório Executivo"].map(escapeCsv).join(";"));
  lines.push(["Loja", payload.storeName].map(escapeCsv).join(";"));
  lines.push(["Período", payload.periodLabel].map(escapeCsv).join(";"));
  lines.push(["Gerado em", payload.generatedAt.toLocaleString("pt-BR")].map(escapeCsv).join(";"));
  lines.push("");
  lines.push(["Resumo financeiro"].map(escapeCsv).join(";"));
  lines.push(["Indicador", "Valor"].map(escapeCsv).join(";"));
  for (const row of metricRows(payload)) lines.push(row.map(escapeCsv).join(";"));
  lines.push("");
  lines.push(["Ranking", "Posição", "Nome", "Quantidade", "Receita", "Lucro"].map(escapeCsv).join(";"));
  const addRanking = (title: string, rows: ReportExportPayload["rankings"]["topSellingProducts"]) => {
    rows.forEach((item, index) => {
      lines.push([title, index + 1, item.label, item.quantity, currency(item.revenue), currency(item.profit)].map(escapeCsv).join(";"));
    });
  };
  addRanking("Produtos mais vendidos", payload.rankings.topSellingProducts);
  addRanking("Produtos mais lucrativos", payload.rankings.mostProfitableProducts);
  addRanking("Clientes que mais gastaram", payload.rankings.clientsByRevenue);
  lines.push("");
  lines.push(["Indicadores", "Valor"].map(escapeCsv).join(";"));
  lines.push(["Quantidade média por venda", number(payload.indicators.averageQuantityPerSale)].map(escapeCsv).join(";"));
  lines.push(["Valor médio do estoque", currency(payload.indicators.averageInventoryValue)].map(escapeCsv).join(";"));
  lines.push(["Produtos sem giro", payload.indicators.productsWithoutTurnover.length].map(escapeCsv).join(";"));
  lines.push(["Produtos críticos", payload.indicators.criticalProducts.length].map(escapeCsv).join(";"));
  downloadTextFile("relatorio-revendasmart.csv", `\uFEFF${lines.join("\n")}`, "text/csv;charset=utf-8");
}
