/**
 * RELEASE V1 §6.3 — movido para `server/photoroom-cutout-adapter.ts` (para ser reaproveitado pela rota
 * real de produção, `server/product-cutout-photoroom.ts`). Este arquivo agora só re-exporta, para
 * nenhum outro arquivo deste harness de smoke-test precisar mudar seu import (`./photoroom`) — nenhuma
 * lógica duplicada, nenhum segundo adapter.
 */
export * from "../../server/photoroom-cutout-adapter";
