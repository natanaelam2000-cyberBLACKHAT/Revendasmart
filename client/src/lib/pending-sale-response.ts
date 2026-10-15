/** A pending sale is removed only after an explicit server acknowledgement. */
export type PendingSaleResponse =
  | { outcome: 'synced' }
  | { outcome: 'already-exists' }
  | { outcome: 'retry' }
  | { outcome: 'conflict'; reason: 'INSUFFICIENT_STOCK' | 'PRODUCT_NOT_FOUND' | 'PRODUCT_CHANGED'; message: string }
  | { outcome: 'failed'; message: string };

export async function classifyPendingSaleResponse(response: Response, saleId: string): Promise<PendingSaleResponse> {
  const value: unknown = await response.json().catch(() => null);
  const data = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  if (response.ok) return data.saleId === saleId ? { outcome: 'synced' } : { outcome: 'retry' };
  if (response.status === 409 && data.code === 'SALE_ALREADY_EXISTS') return { outcome: 'already-exists' };
  if ([408, 429, 500, 502, 503, 504].includes(response.status)) return { outcome: 'retry' };
  const conflicts = {
    INSUFFICIENT_STOCK: ['INSUFFICIENT_STOCK', 'O estoque mudou. Revise os produtos desta venda.'],
    PRODUCT_NOT_FOUND: ['PRODUCT_NOT_FOUND', 'Um produto não está mais disponível. Revise esta venda.'],
    PRODUCT_NOT_AVAILABLE: ['PRODUCT_CHANGED', 'Um produto não está disponível para venda. Revise seu plano e os produtos.'],
    INVALID_PRODUCT_PRICE: ['PRODUCT_CHANGED', 'O preço de um produto mudou. Revise esta venda.'],
  } as const;
  const code = typeof data.code === 'string' ? data.code : '';
  if ((response.status === 400 || response.status === 409) && Object.hasOwn(conflicts, code)) {
    const [reason, message] = conflicts[code as keyof typeof conflicts];
    return { outcome: 'conflict', reason, message };
  }
  const message = response.status === 401
    ? 'Sua sessão expirou. Entre novamente e tente sincronizar a venda.'
    : response.status === 403
      ? 'Você não tem permissão para finalizar esta venda. Verifique sua conta.'
      : response.status === 404
        ? 'O recurso desta venda não foi encontrado. Revise antes de tentar novamente.'
        : 'Não foi possível finalizar esta venda. Revise os dados e tente novamente.';
  return { outcome: 'failed', message };
}
