const { test } = require('node:test');
const assert = require('node:assert/strict');
const id = 'e5ff3db3-548a-4a15-bb0b-892f49de7385';
const origin = 'https://example.test';
async function handler(fetcher) {
  const { createDeleteAccountHandler } = await import('../supabase/functions/delete-account/handler.mjs');
  return createDeleteAccountHandler({ url: 'https://backend.invalid', serviceKey: 'server-only', allowedOrigins: [origin], fetcher });
}
const request = (body = { confirmation: 'DELETE_ACCOUNT' }, token = 'valid') => new Request(`${origin}/delete`, {
  method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});
test('deletion rejects invalid sessions and missing confirmation before any deletion', async () => {
  let calls = 0;
  const run = await handler(async () => { calls++; return new Response('{}', { status: 401 }); });
  assert.equal((await run(request({}))).status, 400);
  assert.equal(calls, 0);
  assert.equal((await run(request())).status, 401);
  assert.equal(calls, 1);
});
test('deletion uses verified user, removes all avatar batches, then hard deletes account', async () => {
  const calls = [];
  let lists = 0;
  const run = await handler(async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/v1/user')) return Response.json({ id });
    if (url.includes('/object/list/')) return Response.json(lists++ === 0 ? [{ id: 'photo', name: 'photo.jpg' }] : []);
    return Response.json({});
  });
  const response = await run(request({ confirmation: 'DELETE_ACCOUNT', userId: 'some-other-user' }));
  assert.equal(response.status, 200);
  assert.equal(calls.at(-1).url, `https://backend.invalid/auth/v1/admin/users/${id}`);
  assert.equal(JSON.parse(calls.at(-1).options.body).should_soft_delete, false);
  const removal = calls.find(call => call.options.method === 'DELETE' && call.url.includes('/storage/'));
  assert.deepEqual(JSON.parse(removal.options.body).prefixes, [`${id}/photo.jpg`]);
});
test('storage failure never reports account deletion as successful', async () => {
  const calls = [];
  const run = await handler(async url => {
    calls.push(url);
    return url.endsWith('/auth/v1/user') ? Response.json({ id }) : new Response('{}', { status: 500 });
  });
  assert.equal((await run(request())).status, 503);
  assert.equal(calls.some(url => url.includes('/admin/users/')), false);
});
