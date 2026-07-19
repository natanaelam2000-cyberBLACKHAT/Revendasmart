export type MarketingShareResult = {
  fileName: string;
  method: "native-file" | "web-file" | "web-download-fallback";
  uri?: string;
};

type WebShareDataWithFiles = ShareData & { files?: File[] };

type ShareMarketingCardOptions = {
  blob: Blob;
  productName: string;
  text: string;
  title?: string;
  dialogTitle?: string;
  onWebDownloadFallback?: (blob: Blob, fileName: string) => void;
  onTextFallback?: (text: string) => Promise<void> | void;
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

export async function blobToBase64Data(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não foi possível preparar o PNG para compartilhamento."));
    reader.onloadend = () => {
      const result = String(reader.result || "");
      const base64 = result.includes(",") ? result.split(",").pop() || "" : result;
      if (!base64) reject(new Error("PNG gerado sem conteúdo compartilhável."));
      else resolve(base64);
    };
    reader.readAsDataURL(blob);
  });
}

async function shareNatively(options: ShareMarketingCardOptions, fileName: string): Promise<MarketingShareResult | null> {
  const { Capacitor } = await import("@capacitor/core");
  if (!Capacitor.isNativePlatform()) return null;

  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import("@capacitor/filesystem"),
    import("@capacitor/share"),
  ]);

  const data = await blobToBase64Data(options.blob);
  const path = `revenda-smart-marketing/${fileName}`;
  const savedFile = await Filesystem.writeFile({
    path,
    data,
    directory: Directory.Cache,
    recursive: true,
  });

  await Share.share({
    title: options.title || "Anúncio Revenda Smart",
    text: options.text,
    files: [savedFile.uri],
    dialogTitle: options.dialogTitle || "Compartilhar anúncio",
  });

  return { method: "native-file", fileName, uri: savedFile.uri };
}

export async function shareMarketingCard(options: ShareMarketingCardOptions): Promise<MarketingShareResult> {
  const fileName = sanitizeMarketingFileName(options.productName);
  const nativeResult = await shareNatively(options, fileName);
  if (nativeResult) return nativeResult;

  const file = new File([options.blob], fileName, { type: "image/png" });
  const nav = navigator as Navigator & {
    canShare?: (data: WebShareDataWithFiles) => boolean;
    share?: (data: WebShareDataWithFiles) => Promise<void>;
  };

  if (typeof nav.share === "function" && typeof nav.canShare === "function" && nav.canShare({ files: [file] })) {
    await nav.share({
      title: options.title || "Anúncio Revenda Smart",
      text: options.text,
      files: [file],
    });
    return { method: "web-file", fileName };
  }

  options.onWebDownloadFallback?.(options.blob, fileName);
  await options.onTextFallback?.(options.text);
  return { method: "web-download-fallback", fileName };
}
