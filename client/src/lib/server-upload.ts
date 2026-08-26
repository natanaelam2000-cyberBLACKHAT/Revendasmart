/**
 * RELEASE-06 — cliente do novo endpoint server-side de upload (`server/uploads.ts`). Substitui o
 * `uploadBytes()` direto ao Storage nos fluxos de produto/logo: agora o servidor valida magic
 * bytes/dimensões reais e aplica quota antes de gravar, em vez de confiar só em tamanho/contentType
 * declarado (o que Storage Rules sozinhas conseguem checar).
 */
import { getApiUrl } from "@/lib/api-config";

export type ServerUploadKind = "product" | "logo" | "cutout" | "campaign-prize";

export interface ServerUploadResult {
  readonly storagePath: string;
  readonly downloadUrl: string;
  readonly width: number;
  readonly height: number;
  readonly deduplicated: boolean;
}

export class ServerUploadError extends Error {
  readonly code: string;
  readonly reason?: string;
  constructor(code: string, reason?: string) {
    super(reason ? `${code}: ${reason}` : code);
    this.name = "ServerUploadError";
    this.code = code;
    this.reason = reason;
  }
}

const SUPPORTED_UPLOAD_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * PROMOTIONAL-CAMPAIGNS-HOTFIX-01 — em mobile (principalmente Android, fotos vindas de `content://` do
 * seletor de galeria/câmera), `File.type` frequentemente vem vazio ou genérico (`application/octet-stream`)
 * mesmo para uma imagem real — o servidor (`server/uploads.ts`) exige que o `Content-Type` declarado
 * bata com o formato real detectado por magic bytes (`shared/image-validation.ts`), então um upload
 * legítimo era rejeitado com `mime-mismatch`. Antes de confiar em `blob.type`, checamos os primeiros
 * bytes no próprio cliente — mesma assinatura que o servidor já valida — e só caímos em `blob.type`/
 * `application/octet-stream` se os bytes não baterem com nenhum formato suportado (nesse caso o
 * servidor vai mesmo rejeitar, corretamente).
 */
async function detectImageMimeType(blob: Blob): Promise<string | null> {
  const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head.length >= 8 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return "image/png";
  if (
    head.length >= 12 && head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46
    && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50
  ) return "image/webp";
  return null;
}

export async function uploadImageViaServer(input: {
  readonly kind: ServerUploadKind;
  readonly targetId?: string;
  readonly blob: Blob;
  readonly token: string;
}): Promise<ServerUploadResult> {
  const path = input.targetId
    ? `/api/uploads/${input.kind}/${encodeURIComponent(input.targetId)}`
    : `/api/uploads/${input.kind}`;

  const contentType = SUPPORTED_UPLOAD_MIME_TYPES.has(input.blob.type)
    ? input.blob.type
    : (await detectImageMimeType(input.blob)) || input.blob.type || "application/octet-stream";

  const response = await fetch(getApiUrl(path), {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      Authorization: `Bearer ${input.token}`,
    },
    body: input.blob,
  });

  if (!response.ok) {
    let body: { error?: string; reason?: string } | null = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    throw new ServerUploadError(body?.error || `HTTP_${response.status}`, body?.reason);
  }

  return response.json() as Promise<ServerUploadResult>;
}

/**
 * RELEASE-18 — apaga um asset gravado pelo endpoint acima. Necessário porque `storage.rules` agora nega
 * write/delete direto do client nesses paths (o bypass que esta tarefa fecha); rollback de upload (ex.:
 * o Firestore write seguinte falhou) precisa passar por aqui em vez de `deleteObject()` direto ao Storage.
 */
export async function deleteImageViaServer(input: {
  readonly kind: ServerUploadKind;
  readonly targetId?: string;
  readonly storagePath: string;
  readonly token: string;
}): Promise<void> {
  const path = input.targetId
    ? `/api/uploads/${input.kind}/${encodeURIComponent(input.targetId)}`
    : `/api/uploads/${input.kind}`;

  const response = await fetch(getApiUrl(path), {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.token}`,
    },
    body: JSON.stringify({ storagePath: input.storagePath }),
  });

  if (!response.ok) {
    let body: { error?: string; reason?: string } | null = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    throw new ServerUploadError(body?.error || `HTTP_${response.status}`, body?.reason);
  }
}
