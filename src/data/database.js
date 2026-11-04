function openDatabase() {
  if (database) return Promise.resolve(database);
  // Riusa l'apertura già in corso se più operazioni IndexedDB partono contemporaneamente.
  if (databaseOpening) return databaseOpening;

  databaseOpening = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('Questo browser non supporta l’archivio locale richiesto.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const legacyOwnerId = localStorage.getItem(LAST_SYNC_USER_KEY) || GUEST_OWNER_ID;
      const migrateStore = (storeName, hasTimestamp) => {
        if (!db.objectStoreNames.contains(storeName)) {
          const store = db.createObjectStore(storeName, { keyPath: 'localKey' });
          store.createIndex('ownerId', 'ownerId', { unique: false });
          if (hasTimestamp) store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
          return;
        }
        const oldStore = request.transaction.objectStore(storeName);
        if (oldStore.keyPath === 'localKey') return;
        const read = oldStore.getAll();
        read.onsuccess = () => {
          const records = read.result || [];
          db.deleteObjectStore(storeName);
          const store = db.createObjectStore(storeName, { keyPath: 'localKey' });
          store.createIndex('ownerId', 'ownerId', { unique: false });
          if (hasTimestamp) store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
          for (const record of records) store.put(normalizeStoredRecord(record, legacyOwnerId));
        };
      };
      migrateStore(STORE_NAME, true);
      migrateStore(PURCHASE_STORE_NAME, true);
      migrateStore(CATEGORY_STORE_NAME, false);
      if (!db.objectStoreNames.contains(PROFILE_DRAFT_STORE_NAME)) {
        db.createObjectStore(PROFILE_DRAFT_STORE_NAME, { keyPath: 'email' });
      }
      if (!db.objectStoreNames.contains(SYNC_STORE_NAME)) db.createObjectStore(SYNC_STORE_NAME, { keyPath: 'ownerId' });
    };
    request.onsuccess = () => {
      const openedDatabase = request.result;
      openedDatabase.onversionchange = () => {
        if (database === openedDatabase) database = null;
        openedDatabase.close();
      };
      openedDatabase.onclose = () => {
        if (database === openedDatabase) database = null;
      };
      database = openedDatabase;
      resolve(openedDatabase);
    };
    request.onerror = () => reject(request.error || new Error('Impossibile aprire l’archivio locale.'));
    request.onblocked = () => reject(new Error('Chiudi eventuali altre schede di SmokeLOG e riprova.'));
  });
  databaseOpening.then(
    () => { databaseOpening = null; },
    () => { databaseOpening = null; }
  );
  return databaseOpening;
}

async function createDatabaseTransaction(mode, storeName = STORE_NAME) {
  // Alcuni browser chiudono la connessione inattiva: riaprila e riprova una sola volta.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const currentDatabase = await openDatabase();
    try {
      return currentDatabase.transaction(storeName, mode);
    } catch (error) {
      if (error.name !== 'InvalidStateError' || attempt > 0) throw error;
      if (database === currentDatabase) database = null;
    }
  }
  throw new Error('Impossibile riaprire l’archivio locale.');
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Operazione non riuscita.'));
    transaction.onabort = () => reject(transaction.error || new Error('Operazione annullata.'));
  });
}

async function readAllEvents(ownerId = activeOwnerId, includeDeleted = false) {
  return readOwnerRecords(STORE_NAME, ownerId, includeDeleted);
}

async function readOwnerRecords(storeName, ownerId, includeDeleted = false) {
  const tx = await createDatabaseTransaction('readonly', storeName);
  const done = transactionDone(tx);
  const request = tx.objectStore(storeName).index('ownerId').getAll(ownerId);
  const result = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error || new Error('Impossibile leggere lo storico.'));
  });
  await done;
  return result.filter(record => record.ownerId === ownerId && (includeDeleted || !record.deletedAt))
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

function normalizeStoredRecord(record, ownerId = activeOwnerId) {
  const recordOwner = ownerId;
  return {
    ...record,
    ownerId: recordOwner,
    localKey: `${recordOwner}:${record.id}`,
    updatedAt: record.updatedAt || record.updated_at || record.timestamp,
    deletedAt: record.deletedAt || record.deleted_at || null
  };
}

async function writeStoredRecord(storeName, record, ownerId, add = false) {
  const tx = await createDatabaseTransaction('readwrite', storeName);
  const store = tx.objectStore(storeName);
  store[add ? 'add' : 'put'](normalizeStoredRecord(storeName === CATEGORY_STORE_NAME ? record : { ...record, pendingSync: true }, ownerId));
  await transactionDone(tx);
}

async function replaceOwnerRecords(storeName, records, ownerId) {
  const tx = await createDatabaseTransaction('readwrite', storeName);
  const store = tx.objectStore(storeName);
  const request = store.getAll();
  request.onsuccess = () => {
    for (const record of request.result || []) {
      if (record.ownerId === ownerId) store.delete(record.localKey);
    }
    for (const record of records) store.put(normalizeStoredRecord(record, ownerId));
  };
  await transactionDone(tx);
}

function recordsNeedingUpload(records, remoteRecords) {
  const remoteById = new Map(remoteRecords.map(record => [record.id, record]));
  return records.filter(record => {
    const remote = remoteById.get(record.id);
    if (!remote || record.pendingSync) return true;
    return Date.parse(record.updatedAt || record.timestamp) > Date.parse(remote.updatedAt || remote.timestamp);
  });
}

function mergeArchiveSnapshot(incoming, current, snapshot) {
  const result = new Map(current.map(record => [record.id, record]));
  const expected = snapshot && new Map(snapshot.map(record => [record.id, record]));
  for (const record of incoming) {
    const local = result.get(record.id);
    // Compare inside the write transaction: a second tab can write after the
    // network snapshot without incrementing this tab's mutation counter.
    if (expected && local && JSON.stringify(local) !== JSON.stringify(expected.get(record.id))) continue;
    if (!expected && local && Date.parse(local.updatedAt || local.timestamp) >= Date.parse(record.updatedAt || record.timestamp)) continue;
    result.set(record.id, record);
  }
  return [...result.values()];
}

async function commitArchive(ownerId, incoming, snapshots = null, guestSnapshots = null, cloudSnapshot = null) {
  const stores = [STORE_NAME, PURCHASE_STORE_NAME, CATEGORY_STORE_NAME];
  const tx = await createDatabaseTransaction('readwrite', cloudSnapshot ? [...stores, SYNC_STORE_NAME] : stores);
  const done = transactionDone(tx);
  if (cloudSnapshot) tx.objectStore(SYNC_STORE_NAME).put(cloudSnapshot);
  const committed = [];
  stores.forEach((name, index) => {
    const store = tx.objectStore(name);
    const request = store.index('ownerId').getAll(ownerId);
    request.onsuccess = () => {
      committed[index] = mergeArchiveSnapshot(incoming[index], request.result, snapshots && snapshots[index])
        .map(record => normalizeStoredRecord(record, ownerId));
      const stored = new Map(request.result.map(record => [record.id, record]));
      for (const record of committed[index]) {
        const normalized = normalizeStoredRecord(record, ownerId);
        if (JSON.stringify(normalized) !== JSON.stringify(stored.get(record.id))) store.put(normalized);
      }
    };
    // Migration and cleanup share the transaction: neither half can commit alone.
    if (guestSnapshots && ownerId !== GUEST_OWNER_ID) {
      for (const snapshot of guestSnapshots[index]) {
        const guest = store.get(`${GUEST_OWNER_ID}:${snapshot.id}`);
        guest.onsuccess = () => {
          if (JSON.stringify(guest.result) === JSON.stringify(snapshot)) store.delete(`${GUEST_OWNER_ID}:${snapshot.id}`);
        };
      }
    }
  });
  await done;
  return committed;
}

async function clearOwnerRecords(storeName, ownerId) {
  const tx = await createDatabaseTransaction('readwrite', storeName);
  const store = tx.objectStore(storeName);
  const request = store.getAll();
  request.onsuccess = () => {
    for (const record of request.result || []) {
      if (record.ownerId === ownerId) store.delete(record.localKey);
    }
  };
  await transactionDone(tx);
}

async function clearOwnerRecordsBySnapshot(storeName, ownerId, records) {
  if (!records.length) return;
  const expected = new Map(records.map(record => [record.id, record.updatedAt || record.timestamp]));
  const tx = await createDatabaseTransaction('readwrite', storeName);
  const store = tx.objectStore(storeName);
  const request = store.getAll();
  request.onsuccess = () => {
    for (const record of request.result || []) {
      const expectedUpdatedAt = expected.get(record.id);
      const actualUpdatedAt = record.updatedAt || record.timestamp;
      if (record.ownerId === ownerId && expectedUpdatedAt && actualUpdatedAt === expectedUpdatedAt) {
        store.delete(record.localKey);
      }
    }
  };
  await transactionDone(tx);
}

async function persistEvent(event, ownerId = activeOwnerId) {
  await writeStoredRecord(STORE_NAME, event, ownerId, true);
}

async function updateStoredEvent(event, ownerId = event.ownerId || activeOwnerId) {
  await writeStoredRecord(STORE_NAME, event, ownerId);
}

async function replaceAllEvents(importedEvents, ownerId = activeOwnerId) {
  await replaceOwnerRecords(STORE_NAME, importedEvents, ownerId);
}

async function clearAllEvents(ownerId = activeOwnerId) {
  await clearOwnerRecords(STORE_NAME, ownerId);
}

async function readAllPurchases(ownerId = activeOwnerId, includeDeleted = false) {
  return readOwnerRecords(PURCHASE_STORE_NAME, ownerId, includeDeleted);
}

async function persistPurchase(purchase, ownerId = activeOwnerId) {
  await writeStoredRecord(PURCHASE_STORE_NAME, purchase, ownerId, true);
}

async function updateStoredPurchase(purchase, ownerId = purchase.ownerId || activeOwnerId) {
  await writeStoredRecord(PURCHASE_STORE_NAME, purchase, ownerId);
}

async function replaceAllPurchases(importedPurchases, ownerId = activeOwnerId) {
  await replaceOwnerRecords(PURCHASE_STORE_NAME, importedPurchases, ownerId);
}

async function clearAllPurchases(ownerId = activeOwnerId) {
  await clearOwnerRecords(PURCHASE_STORE_NAME, ownerId);
}

async function readAllCategories(ownerId = activeOwnerId, includeDeleted = false) {
  return readOwnerRecords(CATEGORY_STORE_NAME, ownerId, includeDeleted);
}

async function persistCategory(category, ownerId = activeOwnerId) {
  await writeStoredRecord(CATEGORY_STORE_NAME, category, ownerId);
}

async function replaceAllCategories(records, ownerId = activeOwnerId) {
  await replaceOwnerRecords(CATEGORY_STORE_NAME, records, ownerId);
}

async function clearAllCategories(ownerId = activeOwnerId) {
  await clearOwnerRecords(CATEGORY_STORE_NAME, ownerId);
}

