async function handleClearData() {
  if (events.length === 0 && purchases.length === 0) {
    showToast('Non ci sono registrazioni o acquisti da eliminare.', 'info');
    return;
  }
  const recordsToDelete = events.length + purchases.length;
  const approved = await openActionDialog({
    title: 'Eliminare tutto lo storico?',
    message: `Stai per eliminare ${events.length} registrazioni e ${purchases.length} acquisti da questo archivio. La cancellazione verrà sincronizzata quando possibile. Esporta prima un backup se vuoi conservarli.`,
    confirmLabel: 'Sì, elimina tutto',
    danger: true
  });
  if (!approved) return;
  let confirmationsReset = false;
  try {
    const deletedAt = new Date().toISOString();
    const wellness = readWellness().payload;
    if (Object.keys(wellness.confirmedDays).length) {
      saveWellness({ ...wellness, confirmedDays: {} });
      confirmationsReset = true;
    }
    const eventTombstones = await readAllEvents(activeOwnerId, true);
    const purchaseTombstones = await readAllPurchases(activeOwnerId, true);
    const tombstone = record => ({ ...record, deletedAt, pendingSync: true,
      updatedAt: new Date(Math.max(Date.parse(deletedAt), (Date.parse(record.updatedAt) || 0) + 1)).toISOString() });
    const committed = await commitArchive(activeOwnerId, [eventTombstones.map(tombstone), purchaseTombstones.map(tombstone), []]);
    markLocalMutation();
    events = committed[0].filter(event => !event.deletedAt);
    purchases = committed[1].filter(purchase => !purchase.deletedAt);
    render();
    requestCloudSync();
    showToast(`${recordsToDelete} voci eliminate dall’archivio.${confirmationsReset ? ' Le conferme delle giornate sono state rimosse e andranno verificate di nuovo.' : ''}`, confirmationsReset ? 'info' : 'success');
  } catch (error) {
    console.error(error);
    if (confirmationsReset) render();
    showToast(`Non è stato possibile eliminare lo storico.${confirmationsReset ? ' Le conferme delle giornate sono state rimosse e andranno verificate di nuovo.' : ''}`, 'error');
  }
}

async function updateStorageStatus() {
  if (!navigator.storage || typeof navigator.storage.persisted !== 'function') {
    elements.storageStatus.textContent = 'Questo browser non permette a SmokeLOG di richiedere la protezione dell’archivio. Conserva periodicamente un backup JSON.';
    return;
  }

  try {
    const isPersistent = await navigator.storage.persisted();
    elements.storageStatus.textContent = isPersistent
      ? 'Protezione attiva: il browser non dovrebbe rimuovere automaticamente questi dati. La cancellazione manuale dei dati del sito può comunque eliminarli.'
      : 'La protezione non è attiva: il browser potrebbe rimuovere i dati in alcune circostanze. Esporta periodicamente un backup JSON.';
  } catch (error) {
    console.error(error);
    elements.storageStatus.textContent = 'Non è stato possibile verificare la protezione dell’archivio. Conserva periodicamente un backup JSON.';
  }
}

async function requestStoragePersistence() {
  if (!navigator.storage || typeof navigator.storage.persist !== 'function') {
    showToast('Questo browser non supporta la protezione dell’archivio.');
    return;
  }

  try {
    const isPersistent = await navigator.storage.persist();
    elements.storageStatus.textContent = isPersistent
      ? 'Protezione attiva: il browser non dovrebbe rimuovere automaticamente questi dati. La cancellazione manuale dei dati del sito può comunque eliminarli.'
      : 'Il browser non ha attivato la protezione. Esporta periodicamente un backup JSON.';
    showToast(isPersistent ? 'Protezione dell’archivio attivata.' : 'Protezione non attivata: crea un backup JSON.');
  } catch (error) {
    console.error(error);
    elements.storageStatus.textContent = 'Non è stato possibile attivare la protezione. Conserva periodicamente un backup JSON.';
    showToast('Richiesta di protezione non riuscita.');
  }
}
