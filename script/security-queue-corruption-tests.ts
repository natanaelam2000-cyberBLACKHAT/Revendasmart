import assert from 'node:assert/strict';
import { isValidPendingSaleDoc } from '../client/src/lib/offline-sales-queue';

const valid = {
  id: 'sale-1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: 'pending',
  payload: { saleId: 'sale-1', clientId: 'client-1', products: [{ productId: 'product-1', quantity: 1 }], discountType: 'fixed', discountValue: 0, paymentType: 'avista', paymentMethod: null },
};
assert.equal(isValidPendingSaleDoc(valid), true);
for (const corrupted of [
  { ...valid, id: '' },
  { ...valid, payload: { ...valid.payload, saleId: 'other-sale' } },
  { ...valid, payload: { ...valid.payload, products: [{ productId: 'product-1', quantity: Number.NaN }] } },
  { ...valid, status: 'unknown' },
  null,
  { id: 'sale-2', status: 'pending', payload: null },
]) assert.equal(isValidPendingSaleDoc(corrupted), false);
console.log('PASS offline queue corruption: invalid documents are rejected by the runtime guard');
