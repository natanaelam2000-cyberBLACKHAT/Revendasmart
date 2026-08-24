/**
 * Parser de argumentos CLI do harness de calibração — PRO-07E.2A.
 *
 * Puro, sem I/O — mesmo padrão de script/marketing-pro-benchmark/cli-args.ts (parsing isolado para ser
 * testável sem disparar o `main()` do orquestrador, que roda automaticamente ao ser importado).
 *
 * §2 do enunciado: o harness só aceita arquivos locais fornecidos explicitamente — nunca varre nada
 * por conta própria, nunca baixa URL, nunca acessa Firebase. `--input` é NÃO-recursivo de propósito:
 * lista só os arquivos diretamente dentro do diretório informado, nunca subpastas — evita que apontar
 * para uma pasta "solta" varra mais do que a pessoa esperava.
 */

export interface CalibrationCliArgs {
  readonly inputDir?: string;
  readonly files: readonly string[];
}

export function parseCalibrationCliArgs(argv: readonly string[]): CalibrationCliArgs {
  let inputDir: string | undefined;
  const files: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--input") {
      if (inputDir !== undefined) throw new Error("--input não pode ser passado mais de uma vez");
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error("--input exige um valor: --input <diretório>");
      inputDir = value;
      i += 1;
    } else if (arg === "--file") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error("--file exige um valor: --file <caminho>");
      files.push(value);
      i += 1;
    } else {
      throw new Error(`Argumento desconhecido: ${arg}`);
    }
  }

  if (inputDir !== undefined && files.length > 0) {
    throw new Error("use --input OU --file, não os dois ao mesmo tempo — evita ambiguidade sobre o que está sendo calibrado");
  }
  if (inputDir === undefined && files.length === 0) {
    throw new Error("forneça --input <diretório> ou pelo menos um --file <caminho>");
  }

  return { inputDir, files };
}
