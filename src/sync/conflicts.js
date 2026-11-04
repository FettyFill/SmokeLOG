async function resolveArchiveConflicts() {
  if (!cloudSession || activeOwnerId !== cloudSession.user.id) throw new Error('Accedi all’archivio dell’account per risolvere i conflitti.');
  const owner = activeOwnerId;
  const remote = await fetchCloudSnapshot(owner);
  const current = await Promise.all([readAllEvents(owner,true),readAllPurchases(owner,true),readAllCategories(owner,true)]);
  const kinds = ['events','purchases','categories'];
  const conflicts = current.flatMap((records,index) => records.flatMap(record => {
    const server = remote[kinds[index]].find(item => item.id === record.id);
    const matches = index === 2 ? categoryStateMatches(record,server) : recordContentMatches(record,server);
    return server && !matches && String(record.revision || '0') !== String(server.revision || '0') && (record.pendingSync || !record.revision) ? [{index,record,server}] : [];
  }));
  if (!conflicts.length) { showToast('Nessun conflitto nelle registrazioni. Per obiettivi e diario usa Consapevolezza.', 'info'); return; }
  const local = await openActionDialog({ title: `${conflicts.length} voci in conflitto`, message: 'Vuoi mantenere le modifiche di questo dispositivo? Le altre registrazioni non cambiano. Puoi prima esportare un backup. Premi Annulla per valutare la versione cloud.', confirmLabel: 'Mantieni questo dispositivo' });
  if (!local) {
    const cloud = await openActionDialog({ title: 'Usare le voci cloud?', message: 'Le modifiche locali alle sole voci in conflitto saranno sostituite con la versione cloud.', confirmLabel: 'Usa cloud', danger: true });
    if (!cloud) return;
  }
  if (owner !== activeOwnerId) return;
  const incoming = current.map(records => records.map(record => ({...record})));
  for (const conflict of conflicts) {
    const index = incoming[conflict.index].findIndex(item => item.id === conflict.record.id);
    incoming[conflict.index][index] = local ? { ...conflict.record, revision: conflict.server.revision, pendingSync: true } : { ...conflict.server, pendingSync: false };
  }
  await commitArchive(owner, incoming, current);
  if (!local) clearCategoryPreferences(owner, remote.categories);
  events = await readAllEvents(); purchases = await readAllPurchases(); categories = await loadCategoriesForOwner(owner);
  markLocalMutation(); render(); requestCloudSync();
}
