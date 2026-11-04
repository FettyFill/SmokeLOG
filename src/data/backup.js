function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function exportJson() {
  const backup = {
    app: 'SmokeLog',
    schemaVersion: 4,
    wellness: { ...readWellness().payload, goals: readGoals() },
    exportedAt: new Date().toISOString(),
    events: [...events].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)),
    purchases: [...purchases].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)),
    categories: categories.map(({ id, name, color, position, isActive, updatedAt }) => ({
      id, name, color, position, isActive, updatedAt
    }))
  };
  downloadFile(`smokelog-backup-${localDateKey(new Date())}.json`, JSON.stringify(backup, null, 2), 'application/json;charset=utf-8');
  showToast('Backup JSON preparato. Salvalo in un luogo sicuro.');
}

function csvEscape(value) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function exportCsv() {
  const rows = [['id', 'tipo', 'importo_eur', 'data_ora_iso', 'data_locale', 'ora_locale', 'quantita', 'unita', 'contesto', 'intensita_voglia']];
  const sorted = [...events].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  for (const event of sorted) {
    const date = new Date(event.timestamp);
    rows.push([
      event.id,
      eventLabel(event.type),
      '',
      event.timestamp,
      date.toLocaleDateString('it-IT'),
      date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
      event.details?.quantity ?? '', event.details?.unit ?? '', event.details?.context || '', event.details?.intensity || ''
    ]);
  }
  const sortedPurchases = [...purchases].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  for (const purchase of sortedPurchases) {
    const date = new Date(purchase.timestamp);
    rows.push([
      purchase.id,
      PURCHASE_LABELS[purchase.type],
      (purchase.amountCents / 100).toFixed(2),
      purchase.timestamp,
      date.toLocaleDateString('it-IT'),
      date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }), '', '', '', ''
    ]);
  }
  const csv = '\uFEFF' + rows.map(row => row.map(csvEscape).join(';')).join('\r\n');
  downloadFile(`smokelog-storico-${localDateKey(new Date())}.csv`, csv, 'text/csv;charset=utf-8');
  showToast('CSV preparato per il salvataggio o l’apertura in un foglio di calcolo.');
}

function validateBackup(parsed) {
  if (!parsed || parsed.app !== 'SmokeLog' || ![1, 2, 3, 4].includes(parsed.schemaVersion) || !Array.isArray(parsed.events)
    || (parsed.schemaVersion >= 2 && !Array.isArray(parsed.purchases))
    || (parsed.schemaVersion >= 3 && !Array.isArray(parsed.categories))) {
    throw new Error('Il file non sembra un backup SmokeLOG valido.');
  }
  const wellness = parsed.schemaVersion >= 4 ? validateWellness(parsed.wellness) : null;
  const exportedAt = typeof parsed.exportedAt === 'string' && Number.isFinite(Date.parse(parsed.exportedAt))
    ? new Date(parsed.exportedAt).toISOString()
    : null;
  const normalizeBackupUpdatedAt = (value, fallback) => {
    if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
    if (typeof fallback === 'string' && Number.isFinite(Date.parse(fallback))) return new Date(fallback).toISOString();
    return exportedAt || new Date(0).toISOString();
  };
  const importedCategories = [];
  const importedCategoryIds = new Set();
  if (parsed.schemaVersion >= 3) {
    const importedNames = new Set();
    for (const item of parsed.categories) {
      const normalizedName = item && typeof item.name === 'string' ? item.name.trim() : '';
      if (!item || typeof item.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/i.test(item.id)
        || !normalizedName || normalizedName.length > 28
        || importedCategoryIds.has(item.id)
        || importedNames.has(normalizedName.toLocaleLowerCase('it-IT'))
        || !Object.hasOwn(CATEGORY_COLORS, item.color)
        || !Number.isInteger(item.position) || item.position < 0
        || typeof item.isActive !== 'boolean'
        || (item.updatedAt !== undefined && item.updatedAt !== null
          && (typeof item.updatedAt !== 'string' || !Number.isFinite(Date.parse(item.updatedAt))))) {
        throw new Error('Il backup contiene una categoria non valida. Nessun dato è stato modificato.');
      }
      importedCategoryIds.add(item.id);
      importedNames.add(normalizedName.toLocaleLowerCase('it-IT'));
      importedCategories.push({
        id: item.id,
        name: normalizedName,
        color: item.color,
        position: item.position,
        isActive: item.isActive,
        updatedAt: normalizeBackupUpdatedAt(item.updatedAt, exportedAt),
        deletedAt: null,
        pendingSync: false
      });
    }
  }
  const seen = new Set();
  const validated = [];
  const allowedTypes = new Set([
    ...Object.keys(EVENT_LABELS),
    ...importedCategoryIds
  ]);
  // Convalida l'intero file prima di modificare l'archivio corrente.
  for (const item of parsed.events) {
    if (!item || typeof item.id !== 'string' || !allowedTypes.has(item.type) || typeof item.timestamp !== 'string' || !Number.isFinite(Date.parse(item.timestamp))
      || (item.updatedAt !== undefined && item.updatedAt !== null
        && (typeof item.updatedAt !== 'string' || !Number.isFinite(Date.parse(item.updatedAt))))) {
      throw new Error('Il backup contiene una registrazione non valida. Nessun dato è stato modificato.');
    }
    let id = item.id;
    if (seen.has(id)) id = makeId();
    seen.add(id);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : makeId();
    const timestamp = new Date(item.timestamp).toISOString();
    validated.push({
      id: uuid,
      type: item.type,
      details: validateRecordDetails(item.details),
      timestamp,
      updatedAt: normalizeBackupUpdatedAt(item.updatedAt, timestamp),
      deletedAt: null
    });
  }
  const seenPurchaseIds = new Set();
  const validatedPurchases = [];
  for (const item of parsed.purchases || []) {
    const amount = Number(item && item.amountCents);
    if (!item || typeof item.id !== 'string' || !Object.hasOwn(PURCHASE_LABELS, item.type)
      || !Number.isSafeInteger(amount) || amount < 1 || amount > 9999999999
      || typeof item.timestamp !== 'string' || !Number.isFinite(Date.parse(item.timestamp))
      || (item.updatedAt !== undefined && item.updatedAt !== null
        && (typeof item.updatedAt !== 'string' || !Number.isFinite(Date.parse(item.updatedAt))))) {
      throw new Error('Il backup contiene un acquisto non valido. Nessun dato è stato modificato.');
    }
    let id = item.id;
    if (seenPurchaseIds.has(id)) id = makeId();
    seenPurchaseIds.add(id);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : makeId();
    const timestamp = new Date(item.timestamp).toISOString();
    validatedPurchases.push({
      id: uuid,
      type: item.type,
      amountCents: amount,
      timestamp,
      updatedAt: normalizeBackupUpdatedAt(item.updatedAt, timestamp),
      deletedAt: null
    });
  }
  return { events: validated, purchases: validatedPurchases, categories: importedCategories, wellness };
}

async function importJsonFile(file) {
  if (!file) return;
  let invalidatedDays = [];
  try {
    if (file.size > MAX_BACKUP_FILE_SIZE) {
      throw new Error('Il backup è troppo grande. Seleziona un file più piccolo di 10 MB.');
    }
    const raw = await file.text();
    const parsed = JSON.parse(raw);
    const validated = validateBackup(parsed);
    const approved = await openActionDialog({
      title: 'Importare il backup?',
      message: `Il backup contiene ${validated.events.length} registrazioni, ${validated.purchases.length} acquisti e ${validated.categories.length} categorie. I dati saranno uniti a quelli presenti, senza eliminare voci più recenti.`,
      confirmLabel: 'Importa backup',
    });
    if (!approved) return;
    const [existingEvents, existingPurchases, existingCategories] = await Promise.all([
      readAllEvents(activeOwnerId, true),
      readAllPurchases(activeOwnerId, true),
      readAllCategories(activeOwnerId, true)
    ]);
    for (const importedCategory of validated.categories) {
      const duplicateName = existingCategories.some(category => category.id !== importedCategory.id
        && category.name.toLocaleLowerCase('it-IT') === importedCategory.name.toLocaleLowerCase('it-IT'));
      if (duplicateName) {
        throw new Error(`Il backup contiene una categoria chiamata “${importedCategory.name}”, già presente con un ID diverso. Rinomina una delle categorie e riprova.`);
      }
    }
    const mergedEvents = mergeById(existingEvents, validated.events);
    const mergedPurchases = mergeById(existingPurchases, validated.purchases);
    const mergedCategories = mergeById(existingCategories, validated.categories);
    const importedDays = [...new Set([...validated.events, ...validated.purchases]
      .map(record => localDateKey(new Date(record.timestamp))))];
    const currentConfirmedDays = readWellness().payload.confirmedDays;
    const reviewDays = importedDays.filter(date => currentConfirmedDays[date] || validated.wellness?.confirmedDays[date]);
    invalidatedDays = invalidateConfirmedDaysForRecords([...validated.events, ...validated.purchases]);
    const committed = await commitArchive(activeOwnerId, [mergedEvents, mergedPurchases, mergedCategories]);
    // A fallback from an earlier edit must not undo a genuinely newer import.
    // Keep newer preferences, including edits made while the import was saving.
    try {
      const preferences = readCategoryPreferences();
      const ownerPreferences = preferences[activeOwnerId] || {};
      for (const category of committed[2]) {
        const preference = ownerPreferences[category.id];
        if (!category.pendingSync && preference && Date.parse(preference.updatedAt) < Date.parse(category.updatedAt)) delete ownerPreferences[category.id];
      }
      preferences[activeOwnerId] = ownerPreferences;
      localStorage.setItem(CATEGORY_PREFERENCES_KEY, JSON.stringify(preferences));
    } catch (error) { console.warn('Preferenze del backup non aggiornate.', error); }
    if (validated.wellness) {
      const existing = readWellness();
      const incoming = validated.wellness;
      const hasLocal = existing.pending || existing.revision !== '0';
      const merged = hasLocal ? { ...existing.payload,
        confirmedDays: { ...incoming.confirmedDays, ...existing.payload.confirmedDays },
        cravings: [...new Map([...incoming.cravings, ...existing.payload.cravings].map(item => [item.id, item])).values()]
      } : incoming;
      for (const date of reviewDays) delete merged.confirmedDays[date];
      saveWellness(merged); goalsFormOwner = null; wellnessFormOwner = null;
    }
    markLocalMutation();
    events = await readAllEvents();
    purchases = await readAllPurchases();
    categories = await loadCategoriesForOwner(activeOwnerId);
    render();
    requestCloudSync();
    showToast(`Importati ${validated.events.length} consumi e ${validated.purchases.length} acquisti.${confirmedDaysReviewMessage(reviewDays)}`, reviewDays.length ? 'info' : 'success');
  } catch (error) {
    console.error(error);
    if (invalidatedDays.length) render();
    await openActionDialog({
      title: 'Importazione non riuscita',
      message: `${error instanceof SyntaxError ? 'Il file selezionato non è un JSON valido.' : (error.message || 'Non è stato possibile importare il backup.')}${confirmedDaysReviewMessage(invalidatedDays)}`,
      notice: true
    });
  } finally {
    elements.importFile.value = '';
  }
}
