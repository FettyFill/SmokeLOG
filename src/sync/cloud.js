async function supabaseRequest(path, options = {}, retry = true) {
  const response = await cloudFetch(`${supabaseConfig.url.replace(/\/$/, '')}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: supabaseConfig.anonKey,
      Authorization: `Bearer ${cloudSession.access_token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (response.status === 401 && retry && cloudSession.refresh_token) {
    // Aggiorna una sola volta il token scaduto e ripete la stessa richiesta.
    const refreshed = await refreshCloudSession(cloudSession.refresh_token);
    saveCloudSession(refreshed);
    return supabaseRequest(path, options, false);
  }
  const responseText = await response.text();
  let result = null;
  if (responseText) {
    try {
      result = JSON.parse(responseText);
    } catch {
      throw new Error(`Risposta del database non valida (HTTP ${response.status}).`);
    }
  }
  if (!response.ok) {
    const schemaErrorCodes = new Set(['PGRST202', 'PGRST204', 'PGRST205', '42P01', '42883']);
    if ((path.includes('smokelog_events') || path.includes('smokelog_purchases') || path.includes('smokelog_categories') || path.includes('merge_smokelog_data'))
      && result && schemaErrorCodes.has(result.code)) {
      const error = new Error('Lo schema Supabase non è aggiornato. Esegui supabase-schema.sql nel SQL Editor del progetto, poi riprova.');
      error.code = result.code;
      error.status = response.status;
      throw error;
    }
    const error = new Error((result && (result.message || result.details || result.hint)) || `Operazione cloud non riuscita (HTTP ${response.status}).`);
    error.code = result && result.code;
    error.status = response.status;
    throw error;
  }
  return result;
}

async function fetchCloudEvents() {
  const eventsFromCloud = [];
  // Legge tutte le pagine: una singola risposta potrebbe non contenere l'intero storico.
  for (let start = 0; ; start += CLOUD_BATCH_SIZE) {
    const rows = await supabaseRequest('smokelog_events?select=id,type,timestamp,updated_at,deleted_at,sync_revision,details&order=timestamp.asc', {
      headers: {
        Range: `${start}-${start + CLOUD_BATCH_SIZE - 1}`,
        'Range-Unit': 'items'
      }
    });
    eventsFromCloud.push(...rows.map(row => ({
      id: row.id,
      type: row.type,
      timestamp: row.timestamp,
      revision: String(row.sync_revision || '0'),
      details: row.details || {},
      updatedAt: row.updated_at || row.timestamp,
      deletedAt: row.deleted_at || null
    })));
    if (rows.length < CLOUD_BATCH_SIZE) break;
  }
  return eventsFromCloud;
}

async function fetchCloudPurchases() {
  const purchasesFromCloud = [];
  for (let start = 0; ; start += CLOUD_BATCH_SIZE) {
    const rows = await supabaseRequest('smokelog_purchases?select=id,type,amount,timestamp,updated_at,deleted_at,sync_revision,details&order=timestamp.asc', {
      headers: {
        Range: `${start}-${start + CLOUD_BATCH_SIZE - 1}`,
        'Range-Unit': 'items'
      }
    });
    purchasesFromCloud.push(...rows.map(row => ({
      id: row.id,
      type: row.type,
      amountCents: Math.round(Number(row.amount) * 100),
      timestamp: row.timestamp,
      revision: String(row.sync_revision || '0'),
      details: row.details || {},
      updatedAt: row.updated_at || row.timestamp,
      deletedAt: row.deleted_at || null
    })));
    if (rows.length < CLOUD_BATCH_SIZE) break;
  }
  return purchasesFromCloud;
}

async function fetchCloudCategories() {
  const categoriesFromCloud = [];
  for (let start = 0; ; start += CLOUD_BATCH_SIZE) {
    const rows = await supabaseRequest('smokelog_categories?select=id,name,color,position,is_active,updated_at,deleted_at,sync_revision&order=position.asc', {
      headers: {
        Range: `${start}-${start + CLOUD_BATCH_SIZE - 1}`,
        'Range-Unit': 'items'
      }
    });
    categoriesFromCloud.push(...rows.map(row => ({
      id: row.id,
      revision: String(row.sync_revision || '0'),
      name: row.name,
      color: row.color,
      position: row.position,
      isActive: row.is_active,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at || null
    })));
    if (rows.length < CLOUD_BATCH_SIZE) break;
  }
  return categoriesFromCloud;
}

function mergeById(...sources) {
  const records = new Map();
  for (const source of sources) {
    for (const record of source) {
      const existing = records.get(record.id);
      const currentTime = Date.parse(record.updatedAt || record.timestamp) || 0;
      const existingTime = existing ? Date.parse(existing.updatedAt || existing.timestamp) || 0 : -1;
      if (!existing || currentTime >= existingTime) records.set(record.id, record);
    }
  }
  return [...records.values()];
}

async function readCloudSnapshot(userId) {
  const tx = await createDatabaseTransaction('readonly', SYNC_STORE_NAME);
  const done = transactionDone(tx);
  const request = tx.objectStore(SYNC_STORE_NAME).get(userId);
  let cached;
  request.onsuccess = () => { cached = request.result; };
  await done;
  return cached || { ownerId: userId, cursor: '0', events: [], purchases: [], categories: [] };
}

async function fetchCloudSnapshot(userId, cached = null) {
  const snapshot = cached || await readCloudSnapshot(userId);
  // Old deployments continue to work until the incremental SQL migration is run.
  try {
    let more = true;
    while (more) {
      const page = await supabaseRequest('rpc/smokelog_changes', {
        method: 'POST', body: JSON.stringify({ p_after: snapshot.cursor, p_limit: CLOUD_BATCH_SIZE })
      });
      for (const kind of ['events', 'purchases', 'categories']) {
        const byId = new Map(snapshot[kind].map(record => [record.id, record]));
        for (const change of page.changes.filter(change => change.kind === kind)) {
          const row = change.record;
          const record = { id: row.id, revision: String(row.sync_revision || '0'), details: row.details || {}, updatedAt: row.updated_at, deletedAt: row.deleted_at || null };
          if (kind === 'categories') Object.assign(record, { name: row.name, color: row.color, position: row.position, isActive: row.is_active });
          else Object.assign(record, { type: row.type, timestamp: row.timestamp });
          if (kind === 'purchases') record.amountCents = Math.round(Number(row.amount) * 100);
          byId.set(record.id, record);
        }
        snapshot[kind] = [...byId.values()];
      }
      if (page.has_more && page.cursor === snapshot.cursor) throw new Error('Il cursore della sincronizzazione non avanza.');
      snapshot.cursor = page.cursor;
      more = page.has_more;
    }
    return snapshot;
  } catch (error) {
    if (!['PGRST202', '42883'].includes(error.code)) throw error;
    const [events, purchases, categories] = await Promise.all([fetchCloudEvents(), fetchCloudPurchases(), fetchCloudCategories()]);
    return { ownerId: userId, cursor: '0', events, purchases, categories };
  }
}

function mergeCategoriesById(localCategories, remoteCategories) {
  const merged = new Map(mergeById(localCategories, remoteCategories).map(category => [category.id, category]));
  for (const remote of remoteCategories) {
    const local = localCategories.find(item => item.id === remote.id);
    if (!local?.pendingSync && remote.revision && (!local?.revision || BigInt(remote.revision) >= BigInt(local.revision))) merged.set(remote.id, remote);
  }
  // Una modifica locale non ancora confermata dal cloud deve prevalere anche
  // se l'altro dispositivo ha un updated_at più recente o l'orologio locale
  // non è perfettamente sincronizzato.
  for (const category of localCategories) {
    if (category.pendingSync) {
      const remote = remoteCategories.find(item => item.id === category.id);
      const updatedAt = new Date(Math.max(
        Date.parse(category.updatedAt) || 0,
        (remote ? Date.parse(remote.updatedAt) || 0 : 0) + (categoryStateMatches(category, remote) ? 0 : 1)
      )).toISOString();
      merged.set(category.id, { ...category, updatedAt });
    }
  }
  return [...merged.values()];
}

function categoryStateMatches(first, second) {
  return Boolean(second) && first.name === second.name && first.color === second.color
    && first.position === second.position && first.isActive === second.isActive
    && (first.deletedAt || null) === (second.deletedAt || null);
}

function isUntouchedDefaultCategory(category) {
  const index = DEFAULT_EVENT_CATEGORIES.findIndex(item => item.id === category.id);
  return index >= 0 && !category.pendingSync && categoryStateMatches(category, {
    ...DEFAULT_EVENT_CATEGORIES[index], position: index, isActive: true
  });
}

function withCloudIds(records) {
  const now = new Date().toISOString();
  return records.map(record => {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(record.id)) return record;
    return { ...record, id: makeId(), updatedAt: now };
  });
}

function markLocalMutation() {
  localMutationVersion += 1;
  renderSyncBadge(cloudSession ? 'Da sincronizzare' : 'Sul dispositivo');
}

async function uploadCloudData(nextEvents, nextPurchases, nextCategories) {
  const batchCount = Math.ceil(Math.max(nextEvents.length, nextPurchases.length, nextCategories.length) / CLOUD_BATCH_SIZE);
  for (let batch = 0; batch < batchCount; batch += 1) {
    const start = batch * CLOUD_BATCH_SIZE;
    await supabaseRequest('rpc/merge_smokelog_data_v2', {
      method: 'POST',
      body: JSON.stringify({
        p_events: nextEvents.slice(start, start + CLOUD_BATCH_SIZE).map(event => ({
          id: event.id,
          base_revision: event.revision || '0',
          details: event.details || {},
          type: event.type,
          timestamp: event.timestamp,
          updated_at: event.updatedAt || event.timestamp,
          deleted_at: event.deletedAt || null
        })),
        p_purchases: nextPurchases.slice(start, start + CLOUD_BATCH_SIZE).map(purchase => ({
          id: purchase.id,
          base_revision: purchase.revision || '0',
          details: purchase.details || {},
          type: purchase.type,
          amount: purchase.amountCents / 100,
          timestamp: purchase.timestamp,
          updated_at: purchase.updatedAt || purchase.timestamp,
          deleted_at: purchase.deletedAt || null
        })),
        p_categories: nextCategories.slice(start, start + CLOUD_BATCH_SIZE).map(category => ({
          id: category.id,
          base_revision: category.revision || '0',
          name: category.name,
          color: category.color,
          position: category.position,
          is_active: Boolean(category.isActive),
          updated_at: category.updatedAt,
          deleted_at: category.deletedAt || null
        }))
      })
    });
  }
}

function syncCloudEvents() {
  // Accorpa le sincronizzazioni concorrenti, ma programma un altro passaggio
  // se nel frattempo l'utente ha modificato lo storico locale.
  if (cloudSyncPromise) {
    cloudSyncNeedsAnotherPass = true;
    return cloudSyncPromise;
  }
  cloudSyncPromise = (async () => {
    do {
      cloudSyncNeedsAnotherPass = false;
      const syncVersion = localMutationVersion;
      await performCloudSync(syncVersion);
      if (localMutationVersion !== syncVersion) cloudSyncNeedsAnotherPass = true;
    } while (cloudSyncNeedsAnotherPass);
  })().finally(() => {
    cloudSyncPromise = null;
  });
  return cloudSyncPromise;
}

function requestCloudSync() {
  if (!cloudConfigured || !cloudSession || !cloudSession.user || !cloudSession.user.id) return;
  clearTimeout(cloudSyncTimer);
  cloudSyncTimer = setTimeout(() => {
    void syncCloudEvents().catch(error => {
      console.error(error);
      const detail = error instanceof Error && error.message ? ` ${error.message}` : '';
      setAccountStatus(`Salvato sul dispositivo. Sincronizzazione in attesa.${detail}`, false, false, true);
      renderSyncBadge('Sul dispositivo · sincronizzazione da riprovare');
    });
  }, 250);
}

async function performCloudSync(syncVersion) {
  renderSyncBadge('Sincronizzazione…');
  if (!cloudSession || !cloudSession.user || !cloudSession.user.id) {
    throw new Error('La sessione non contiene un account valido. Accedi di nuovo.');
  }
  const userId = cloudSession.user.id;
  const ensureSessionActive = () => {
    if (!cloudSession || !cloudSession.user || cloudSession.user.id !== userId) {
      throw new Error('La sessione è terminata durante la sincronizzazione. Accedi di nuovo.');
    }
  };
  const [accountEvents, guestEvents, accountPurchases, guestPurchases, accountCategories, guestCategories] = await Promise.all([
    readAllEvents(userId, true),
    readAllEvents(GUEST_OWNER_ID, true),
    readAllPurchases(userId, true),
    readAllPurchases(GUEST_OWNER_ID, true),
    readAllCategories(userId, true),
    readAllCategories(GUEST_OWNER_ID, true)
  ]);
  ensureSessionActive();
  const remoteSnapshot = await fetchCloudSnapshot(userId);
  const { events: remoteEvents, purchases: remotePurchases, categories: remoteCategories } = remoteSnapshot;
  ensureSessionActive();
  const timestamp = new Date().toISOString();
  const defaults = DEFAULT_EVENT_CATEGORIES.map((category, index) => ({
    ...category,
    position: index,
    isActive: true,
    updatedAt: timestamp,
    deletedAt: null
  }));
  const localEvents = withCloudIds([...accountEvents, ...guestEvents]);
  const localPurchases = withCloudIds([...accountPurchases, ...guestPurchases]);
  // I default guest ricreati all'avvio non sono modifiche dell'utente.
  const localCategories = [...accountCategories, ...guestCategories.filter(category => !isUntouchedDefaultCategory(category))];
  const nextEvents = mergePendingRecords(localEvents, remoteEvents);
  const nextPurchases = mergePendingRecords(localPurchases, remotePurchases);
  const mergedCategoriesBeforeDefaults = mergeCategoriesById(localCategories, remoteCategories);
  const knownCategoryIds = new Set(mergedCategoriesBeforeDefaults.map(category => category.id));
  const nextCategories = [...mergedCategoriesBeforeDefaults, ...defaults.filter(category => !knownCategoryIds.has(category.id))]
    .filter(category => !category.deletedAt);
  await uploadCloudData(
    recordsNeedingUpload(nextEvents, remoteEvents),
    recordsNeedingUpload(nextPurchases, remotePurchases),
    recordsNeedingUpload(nextCategories, remoteCategories)
  );
  ensureSessionActive();
  const finalSnapshot = await fetchCloudSnapshot(userId, remoteSnapshot);
  const { events: finalEvents, purchases: finalPurchases, categories: finalCategories } = finalSnapshot;
  const mergedEvents = confirmPendingRecords(nextEvents, finalEvents);
  const mergedPurchases = confirmPendingRecords(nextPurchases, finalPurchases);
  const mergedCategories = mergeCategoriesById(nextCategories, finalCategories);

  // Rileggiamo l'archivio locale subito prima del commit. Se una registrazione
  // è stata aggiunta, modificata o rimossa durante il giro cloud, la includiamo
  // nella fotografia finale e lasciamo che il passaggio successivo la invii.
  const [latestAccountEvents, latestGuestEvents, latestAccountPurchases, latestGuestPurchases, latestAccountCategories, latestGuestCategories] = await Promise.all([
    readAllEvents(userId, true),
    readAllEvents(GUEST_OWNER_ID, true),
    readAllPurchases(userId, true),
    readAllPurchases(GUEST_OWNER_ID, true),
    readAllCategories(userId, true),
    readAllCategories(GUEST_OWNER_ID, true)
  ]);
  if (localMutationVersion !== syncVersion) {
    cloudSyncNeedsAnotherPass = true;
    return;
  }

  const latestLocalEvents = withCloudIds([...latestAccountEvents, ...latestGuestEvents]);
  const latestLocalPurchases = withCloudIds([...latestAccountPurchases, ...latestGuestPurchases]);
  const latestLocalCategories = [...latestAccountCategories, ...latestGuestCategories.filter(category => !isUntouchedDefaultCategory(category))];
  const committedEvents = mergedEvents;
  const committedPurchases = mergedPurchases;
  const committedCategories = mergeCategoriesById(mergedCategories, latestLocalCategories);
  const syncedCategories = committedCategories.map(category => ({
    ...category,
    revision: finalCategories.find(item => item.id === category.id)?.revision || category.revision || '0',
    pendingSync: !categoryStateMatches(category, finalCategories.find(item => item.id === category.id))
  }));

  ensureSessionActive();
  const committed = await commitArchive(userId,
    [committedEvents, committedPurchases, syncedCategories],
    [latestAccountEvents, latestAccountPurchases, latestAccountCategories],
    [latestGuestEvents, latestGuestPurchases, latestGuestCategories], finalSnapshot);
  if (localMutationVersion === syncVersion) {
    // Elimina il fallback solo se il cloud ha davvero restituito lo stesso
    // stato. Se Supabase conserva ancora il valore precedente, la preferenza
    // locale resta pending e protegge il pulsante al prossimo caricamento.
    clearCategoryPreferences(userId, finalCategories);
    clearCategoryPreferences(GUEST_OWNER_ID, finalCategories);
  }
  if (localMutationVersion !== syncVersion) cloudSyncNeedsAnotherPass = true;
  ensureSessionActive();
  activeOwnerId = userId;
  events = committed[0].filter(event => !event.deletedAt).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  purchases = committed[1].filter(purchase => !purchase.deletedAt).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  categories = committed[2].filter(category => !category.deletedAt).sort((a, b) => a.position - b.position);
  render();
  localStorage.setItem(LAST_SYNC_USER_KEY, userId);
  isAuthenticated = true;
  isAppReady = true;
  populateProfileSettings(cloudSession.user);
  updateAccountControls();
  closeAuthenticationModal();
  setAccountStatus(`Sincronizzato con l’account ${cloudSession.user.email}.`);
  await syncWellness(userId);
  renderSyncBadge('Sincronizzato');
  renderInsights();
}

