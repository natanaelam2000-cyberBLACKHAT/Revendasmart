import assert from 'node:assert/strict';
import { classifyPendingSaleResponse } from '../client/src/lib/pending-sale-response.ts';
const saleId = 'sale-test-01';
const json = (status, value) => new Response(JSON.stringify(value), { status });
assert.deepEqual(await classifyPendingSaleResponse(json(201, { saleId }), saleId), { outcome: 'synced' });
for (const value of [null, {}, [], { saleId: 'another-sale' }]) {
  assert.equal((await classifyPendingSaleResponse(json(200, value), saleId)).outcome, 'retry');
}
for (const response of [new Response('', { status: 200 }), new Response('<html>proxy</html>', { status: 200 }), new Response(null, { status: 204 })]) {
  assert.equal((await classifyPendingSaleResponse(response, saleId)).outcome, 'retry', 'unconfirmed success must retain the queue');
}
for (const status of [408, 429, 500, 502, 503, 504]) {
  assert.equal((await classifyPendingSaleResponse(json(status, {}), saleId)).outcome, 'retry');
}
assert.equal((await classifyPendingSaleResponse(json(409, { code: 'SALE_ALREADY_EXISTS' }), saleId)).outcome, 'already-exists');
assert.equal((await classifyPendingSaleResponse(json(500, { code: 'SALE_ALREADY_EXISTS' }), saleId)).outcome, 'retry');
for (const code of ['INSUFFICIENT_STOCK', 'PRODUCT_NOT_FOUND', 'PRODUCT_NOT_AVAILABLE', 'INVALID_PRODUCT_PRICE']) {
  assert.equal((await classifyPendingSaleResponse(json(409, { code }), saleId)).outcome, 'conflict');
}
for (const status of [400, 401, 403, 404, 409, 422]) {
  const result = await classifyPendingSaleResponse(json(status, { message: '<html>internal stack trace</html>' }), saleId);
  assert.equal(result.outcome, 'failed');
  assert.ok(!result.message.includes('internal'));
}
console.log('PASS pending-sale response: acknowledgements, malformed/empty JSON, replay, transient HTTP, conflict and safe messages');
