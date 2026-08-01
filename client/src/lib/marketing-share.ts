export type MarketingShareResult = {
  fileName: string;
  method: "native-file" | "web-file" | "web-download-fallback";
  uri?: string;
};

export type MarketingSaveResult = {
  fileName: string;
  method: "native-documents" | "web-download";
  uri?: string;
  locationLabel: string;
};

type WebShareDataWithFiles = ShareData & { files?: File[] };

type MarketingNativeShareRequest = {
  title: string;
  text: string;
  files: string[];
  dialogTitle: string;
};

export type MarketingNativeBridge = {
  writeCacheFile: (path: string, data: string) => Promise<{ uri: string }>;
  writeDocumentFile: (path: string, data: string) => Promise<{ uri: string }>;
  deleteCacheFile: (path: string) => Promise<void>;
  share: (request: MarketingNativeShareRequest) => Promise<void>;
};

type MarketingPlatformDependencies = {
  getNativeBridge?: () => Promise<MarketingNativeBridge | null>;
  readBlobDataUrl?: (blob: Blob) => Promise<string>;
  now?: () => Date;
  scheduleCleanup?: (task: () => void, delayMs: number) => void;
  webNavigator?: Navigator & {
    canShare?: (data: WebShareDataWithFiles) => boolean;
    share?: (data: WebShareDataWithFiles) => Promise<void>;
  };
  triggerWebDownload?: (blob: Blob, fileName: string) => void;
};

export class MarketingShareCancelledError extends Error {
  constructor() {
    super("Compartilhamento cancelado.");
    this.name = "MarketingShareCancelledError";
  }
}

export type MarketingFileOperationCode = "cache-write" | "documents-write" | "native-share";

export class MarketingFileOperationError extends Error {
  readonly code: MarketingFileOperationCode;

  constructor(code: MarketingFileOperationCode, cause?: unknown) {
    const messages: Record<MarketingFileOperationCode, string> = {
      "cache-write": "O PNG foi gerado, mas não pôde ser preparado no aparelho.",
      "documents-write": "O PNG foi gerado, mas não pôde ser salvo em Documentos.",
      "native-share": "O PNG foi gerado, mas o compartilhamento do aparelho não pôde ser aberto.",
    };
    super(messages[code], { cause });
    this.name = "MarketingFileOperationError";
    this.code = code;
  }
}

export function isMarketingShareCancelledError(error: unknown): boolean {
  if (error instanceof MarketingShareCancelledError) return true;
  const message = error instanceof Error ? error.message : String(error || "");
  return /cancel|abort|dismiss|fechad|cancelad/i.test(message);
}

type ShareMarketingCardOptions = {
  blob: Blob;
  productName: string;
  text: string;
  title?: string;
  dialogTitle?: string;
  onWebDownloadFallback?: (blob: Blob, fileName: string) => void;
  onTextFallback?: (text: string) => Promise<void> | void;
};

type SaveMarketingCardOptions = {
  blob: Blob;
  productName: string;
};

export function sanitizeMarketingFileName(productName: string): string {
  const slug = String(productName || "card")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "card";
  return `anuncio-${slug}.png`;
}

export function createUniqueMarketingFileName(productName: string, now = new Date()): string {
  const baseName = sanitizeMarketingFileName(productName).replace(/\.png$/i, "");
  const timestamp = now.toISOString().replace(/\D/g, "").slice(0, 17);
  return `${baseName}-${timestamp}.png`;
}

export function stripMarketingDataUrlPrefix(value: string): string {
  return value.includes(",") ? value.slice(value.indexOf(",") + 1).replace(/\s+/g, "") : value.replace(/\s+/g, "");
}

async function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não foi possível preparar o PNG para compartilhamento."));
    reader.onloadend = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(blob);
  });
}

export async function blobToBase64Data(blob: Blob, readBlobDataUrl: (blob: Blob) => Promise<string> = readBlobAsDataUrl): Promise<string> {
  const base64 = stripMarketingDataUrlPrefix(await readBlobDataUrl(blob));
  if (!base64 || !/^[a-z0-9+/]+={0,2}$/i.test(base64)) throw new Error("PNG gerado sem conteúdo compartilhável.");
  return base64;
}

export function triggerMarketingWebDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = fileName;
  link.href = url;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 3_000);
}

async function getDefaultNativeBridge(): Promise<MarketingNativeBridge | null> {
  const { Capacitor } = await import("@capacitor/core");
  if (!Capacitor.isNativePlatform()) return null;

  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import("@capacitor/filesystem"),
    import("@capacitor/share"),
  ]);

  return {
    writeCacheFile: (path, data) => Filesystem.writeFile({ path, data, directory: Directory.Cache, recursive: true }),
    writeDocumentFile: (path, data) => Filesystem.writeFile({ path, data, directory: Directory.Documents, recursive: true }),
    deleteCacheFile: (path) => Filesystem.deleteFile({ path, directory: Directory.Cache }),
    share: async (request) => { await Share.share(request); },
  };
}

function defaultScheduleCleanup(task: () => void, delayMs: number) {
  window.setTimeout(task, delayMs);
}

function scheduleTemporaryFileCleanup(
  bridge: MarketingNativeBridge,
  path: string,
  dependencies: MarketingPlatformDependencies,
) {
  const schedule = dependencies.scheduleCleanup || defaultScheduleCleanup;
  schedule(() => { void bridge.deleteCacheFile(path).catch(() => undefined); }, 60_000);
}

async function shareNatively(
  options: ShareMarketingCardOptions,
  fileName: string,
  bridge: MarketingNativeBridge,
  dependencies: MarketingPlatformDependencies,
): Promise<MarketingShareResult> {
  const data = await blobToBase64Data(options.blob, dependencies.readBlobDataUrl);
  const path = `revenda-smart-marketing/${fileName}`;
  let savedFile: { uri: string };
  try {
    savedFile = await bridge.writeCacheFile(path, data);
  } catch (error) {
    throw new MarketingFileOperationError("cache-write", error);
  }

  try {
    await bridge.share({
      title: options.title || "Anúncio Revenda Smart",
      text: options.text,
      files: [savedFile.uri],
      dialogTitle: options.dialogTitle || "Compartilhar anúncio",
    });
  } catch (error) {
    if (isMarketingShareCancelledError(error)) throw new MarketingShareCancelledError();
    throw new MarketingFileOperationError("native-share", error);
  } finally {
    scheduleTemporaryFileCleanup(bridge, path, dependencies);
  }

  return { method: "native-file", fileName, uri: savedFile.uri };
}

export async function shareMarketingCard(
  options: ShareMarketingCardOptions,
  dependencies: MarketingPlatformDependencies = {},
): Promise<MarketingShareResult> {
  const fileName = createUniqueMarketingFileName(options.productName, dependencies.now?.());
  const nativeBridge = await (dependencies.getNativeBridge || getDefaultNativeBridge)();
  if (nativeBridge) return shareNatively(options, fileName, nativeBridge, dependencies);

  const file = typeof File === "function" ? new File([options.blob], fileName, { type: "image/png" }) : null;
  const nav = dependencies.webNavigator || navigator as Navigator & {
    canShare?: (data: WebShareDataWithFiles) => boolean;
    share?: (data: WebShareDataWithFiles) => Promise<void>;
  };

  if (file && typeof nav.share === "function" && typeof nav.canShare === "function" && nav.canShare({ files: [file] })) {
    try {
      await nav.share({
        title: options.title || "Anúncio Revenda Smart",
        text: options.text,
        files: [file],
      });
    } catch (error) {
      if (isMarketingShareCancelledError(error)) throw new MarketingShareCancelledError();
      throw error;
    }
    return { method: "web-file", fileName };
  }

  const download = options.onWebDownloadFallback || dependencies.triggerWebDownload || triggerMarketingWebDownload;
  download(options.blob, fileName);
  await options.onTextFallback?.(options.text);
  return { method: "web-download-fallback", fileName };
}

export async function saveMarketingCard(
  options: SaveMarketingCardOptions,
  dependencies: MarketingPlatformDependencies = {},
): Promise<MarketingSaveResult> {
  const fileName = createUniqueMarketingFileName(options.productName, dependencies.now?.());
  const nativeBridge = await (dependencies.getNativeBridge || getDefaultNativeBridge)();
  if (nativeBridge) {
    const data = await blobToBase64Data(options.blob, dependencies.readBlobDataUrl);
    const path = `Revenda Smart/${fileName}`;
    try {
      const savedFile = await nativeBridge.writeDocumentFile(path, data);
      return {
        method: "native-documents",
        fileName,
        uri: savedFile.uri,
        locationLabel: "Documentos/Revenda Smart",
      };
    } catch (error) {
      throw new MarketingFileOperationError("documents-write", error);
    }
  }

  const download = dependencies.triggerWebDownload || triggerMarketingWebDownload;
  download(options.blob, fileName);
  return { method: "web-download", fileName, locationLabel: "Downloads" };
}
