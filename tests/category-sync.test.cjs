const { test } = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./harness.cjs');

test('account button settings survive repeated guest initialization and sync', async () => {
  const run = harness();
  await run(`(async () => {
    remote.categories = [{ ...DEFAULT_EVENT_CATEGORIES[0], name: 'Personalizzato', position: 4,
      isActive: false, updatedAt: '2026-01-01T00:00:00.000Z' }];
    for (let reload = 0; reload < 3; reload++) {
      await loadCategoriesForOwner('guest');
      await performCloudSync(0);
    }
  })()`);
  const records = await run(`readAllCategories('account')`);
  const category = records.find(item => item.id === 'cigarette');
  assert.equal(category.name, 'Personalizzato');
  assert.equal(category.isActive, false);
  assert.equal(category.position, 4);
  assert.ok(records.every(item => item.ownerId === 'account'));
});

test('guest customization migrates atomically to the account', async () => {
  const run = harness();
  await run(`(async () => {
    const guest = await loadCategoriesForOwner('guest');
    await persistCategory({ ...guest[0], name: 'Ospite', pendingSync: true }, 'guest');
    await performCloudSync(0);
  })()`);
  const records = await run(`readAllCategories('account')`);
  assert.equal(records.find(item => item.id === 'cigarette').name, 'Ospite');
  assert.equal(records.find(item => item.id === 'cigarette').localKey, 'account:cigarette');
  assert.equal((await run(`readAllCategories('guest')`)).length, 0);
  assert.equal(run(`categories.every(category => category.ownerId === 'account')`), true);
});

test('unconfirmed settings stay pending and supersede a remote clock ahead', async () => {
  const run = harness();
  await run(`(async () => {
    const stored = await loadCategoriesForOwner('account');
    remote.categories = stored.map(item => ({ ...item, updatedAt: '2027-01-01T00:00:00.000Z' }));
    await persistCategory({ ...stored[0], name: 'In attesa', pendingSync: true }, 'account');
    rejectUpload = true;
    await performCloudSync(0);
  })()`);
  const category = (await run(`readAllCategories('account')`)).find(item => item.id === 'cigarette');
  assert.equal(category.name, 'In attesa');
  assert.equal(category.pendingSync, true);
  assert.ok(Date.parse(category.updatedAt) > Date.parse('2027-01-01'));
});

test('unchanged events and purchases are not uploaded again', async () => {
  const run = harness();
  await run(`(async () => {
    remote.events = [{ id: 'e5ff3db3-548a-4a15-bb0b-892f49de7385', type: 'cigarette', timestamp: '2026-01-01', updatedAt: '2026-01-01' }];
    await performCloudSync(0);
    await performCloudSync(0);
  })()`);
  assert.equal(run('uploaded[1].events.length'), 0);
  assert.equal(run('uploaded[1].purchases.length'), 0);
});

test('a recording made during the network upload is sent on the next pass without loss', async () => {
  const run = harness();
  await run(`(async () => {
    const originalUpload = uploadCloudData;
    let inserted = false;
    uploadCloudData = async (...args) => {
      if (!inserted) {
        inserted = true;
        await persistEvent({ id: 'e5ff3db3-548a-4a15-bb0b-892f49de7385', type: 'cigarette', timestamp: '2026-10-28', updatedAt: '2026-10-28' }, 'account');
        markLocalMutation();
      }
      await originalUpload(...args);
    };
    await syncCloudEvents();
  })()`);
  assert.equal((await run(`readAllEvents('account')`)).length, 1);
  assert.equal(run('remote.events.length'), 1);
  assert.ok(run('uploaded.length') >= 2);
});
