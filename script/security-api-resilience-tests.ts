import assert from 'node:assert/strict';
import fs from 'node:fs';
import { apiRequest, ApiError } from '../client/src/lib/api-client';

for (const leaked of [
  'C:\\srv\\app\\server.ts:42 database exception',
  '/home/node/app/server/routes.ts',
  'SELECT password FROM users WHERE uid = ?',
  'TypeError: cannot read properties of undefined',
]) {
  await assert.rejects(
    apiRequest('/api/internal-error', {
      fetchImpl: async () => new Response(leaked, { status: 500, headers: { 'Content-Type': 'text/plain' } }),
    }),
    (error: unknown) => error instanceof ApiError
      && error.message === 'Falha temporária do serviço. Tente novamente.'
      && !error.message.includes(leaked),
  );
}

const login = fs.readFileSync('client/src/pages/login.tsx', 'utf8');
assert.match(login, /const loginInFlightRef = useRef\(false\)/);
assert.match(login, /if \(loginInFlightRef\.current\) return/);
assert.match(login, /loginInFlightRef\.current = true/);
assert.match(login, /finally \{[\s\S]*loginInFlightRef\.current = false/);

console.log('PASS auth/API resilience: synchronous login single-flight and internal error redaction');
