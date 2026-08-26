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

export async function uploadImageViaServer(input: {
  readonly kind: ServerUploadKind;
  readonly targetId?: string;
  readonly blob: Blob;
  readonly token: string;
}): Promise<ServerUploadResult> {
  const path = input.targetId
    ? `/api/uploads/${input.kind}/${encodeURIComponent(input.targetId)}`
    : `/api/uploads/${input.kind}`;

  const response = await fetch(getApiUrl(path), {
    method: "POST",
    headers: {
      "Content-Type": input.blob.type || "application/octet-stream",
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
