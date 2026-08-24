/**
 * RELEASE V1 §6.3 — movido para `server/photoroom-png.ts` (para ser reaproveitado pela rota real de
 * produção). Este arquivo agora só re-exporta, para nenhum outro arquivo deste harness de smoke-test
 * precisar mudar seu import (`./png`) — nenhuma lógica duplicada, nenhum segundo decoder.
 */
export * from "../../server/photoroom-png";
