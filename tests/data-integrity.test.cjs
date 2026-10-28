const { test } = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./harness.cjs');

test('atomic commit preserves inserts, edits and deletions made after the sync snapshot', async () => {
  const run = harness();
  await run(`(async () => {
    const initial = { id: 'one', type: 'cigarette', timestamp: '2026-01-01', updatedAt: '2026-01-01' };
    await persistEvent(initial, 'account');
    const snapshot = await readAllEvents('account', true);
    await persistEvent({ ...initial, id: 'new' }, 'account');
    await updateStoredEvent({ ...initial, updatedAt: '2026-02-01', deletedAt: '2026-02-01' }, 'account');
    await commitArchive('account', [[initial], [], []], [snapshot, [], []]);
  })()`);
  const records = await run(`readAllEvents('account', true)`);
  assert.equal(records.length, 2);
  assert.equal(records.find(item => item.id === 'one').deletedAt, '2026-02-01');
});

test('guest edited after snapshot is not erased by migration cleanup', async () => {
  const run = harness();
  await run(`(async () => {
    const initial = { id: 'one', type: 'cigarette', timestamp: '2026-01-01', updatedAt: '2026-01-01' };
    await persistEvent(initial, 'guest');
    const snapshot = await readAllEvents('guest', true);
    await updateStoredEvent({ ...initial, type: 'joint' }, 'guest');
    await commitArchive('account', [snapshot, [], []], [[], [], []], [snapshot, [], []]);
  })()`);
  assert.equal((await run(`readAllEvents('guest')`))[0].type, 'joint');
});

test('aborted multi-store commit rolls back records and cursor together', async () => {
  const run = harness();
  await run(`(async () => {
    await persistEvent({ id: 'old', type: 'cigarette', timestamp: '2026-01-01', updatedAt: '2026-01-01' }, 'account');
    const original = createDatabaseTransaction;
    createDatabaseTransaction = async (mode, stores) => {
      const tx = await original(mode, stores);
      if (mode === 'readwrite' && Array.isArray(stores)) {
        const store = tx.objectStore(STORE_NAME);
        const put = store.put.bind(store);
        store.put = (...args) => { const request = put(...args); request.onsuccess = () => tx.abort(); return request; };
      }
      return tx;
    };
    try {
      await commitArchive('account', [[{ id: 'new', timestamp: '2026-02-01', updatedAt: '2026-02-01' }], [], []], null, null,
        { ownerId: 'account', cursor: '5', events: [], purchases: [], categories: [] });
      throw new Error('Expected abort');
    } catch (error) { if (error.message === 'Expected abort') throw error; }
    createDatabaseTransaction = original;
  })()`);
  assert.equal((await run(`readAllEvents('account')`)).length, 1);
  assert.equal((await run(`readCloudSnapshot('account')`)).cursor, '0');
});

test('old backups retain timestamps and cannot override newer records or tombstones', async () => {
  const run = harness();
  await run(`(async () => {
    const id = 'e5ff3db3-548a-4a15-bb0b-892f49de7385';
    const validated = validateBackup({ app: 'SmokeLog', schemaVersion: 3, events: [
      { id, type: 'cigarette', timestamp: '2026-01-01', updatedAt: '2026-01-02' }
    ], purchases: [], categories: [{ ...DEFAULT_EVENT_CATEGORIES[0], position: 0, isActive: true, updatedAt: '2026-01-02' }] });
    await persistEvent({ id, type: 'cigarette', timestamp: '2026-01-01', updatedAt: '2026-02-01', deletedAt: '2026-02-01' }, 'account');
    await persistCategory({ ...validated.categories[0], name: 'Nuovo', updatedAt: '2026-02-01' }, 'account');
    await commitArchive('account', [validated.events, validated.purchases, validated.categories]);
  })()`);
  assert.equal((await run(`readAllEvents('account')`)).length, 0);
  assert.equal((await run(`readAllCategories('account')`))[0].name, 'Nuovo');
  assert.equal(run(`validateBackup({ app: 'SmokeLog', schemaVersion: 1, events: [{ id: 'e5ff3db3-548a-4a15-bb0b-892f49de7385', type: 'cigarette', timestamp: '2020-01-01' }] }).events[0].updatedAt`), '2020-01-01T00:00:00.000Z');
});

test('incremental download paginates, persists tombstones and uses the committed cursor', async () => {
  const run = harness();
  await run(`(async () => {
    let requests = [];
    supabaseRequest = async (path, options) => {
      const cursor = JSON.parse(options.body).p_after;
      requests.push(cursor);
      return cursor === '0' ? { cursor: '1', has_more: true, changes: [{ kind: 'events', record: {
        id: 'one', type: 'cigarette', timestamp: '2026-01-01', updated_at: '2026-01-01', deleted_at: null
      }}] } : { cursor: '2', has_more: false, changes: [{ kind: 'events', record: {
        id: 'one', type: 'cigarette', timestamp: '2026-01-01', updated_at: '2026-02-01', deleted_at: '2026-02-01'
      }}] };
    };
    const snapshot = await originalFetchCloudSnapshot('account');
    await commitArchive('account', [snapshot.events, [], []], null, null, snapshot);
    if (requests.join(',') !== '0,1') throw new Error('Pagination failed');
  })()`);
  const cached = await run(`readCloudSnapshot('account')`);
  assert.equal(cached.cursor, '2');
  assert.equal(cached.events[0].deletedAt, '2026-02-01');
});

test('legacy server fallback is limited to missing RPC, not network or permission errors', async () => {
  const run = harness();
  await run(`(async () => {
    supabaseRequest = async () => { const error = new Error('Missing RPC'); error.code = 'PGRST202'; throw error; };
    fetchCloudEvents = async () => []; fetchCloudPurchases = async () => []; fetchCloudCategories = async () => [];
    await originalFetchCloudSnapshot('account');
    supabaseRequest = async () => { throw new Error('Network unavailable'); };
  })()`);
  await assert.rejects(run(`originalFetchCloudSnapshot('account')`), /Network unavailable/);
});
