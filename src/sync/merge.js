// Pending changes retain their original server revision until acknowledged.
function mergePendingRecords(local, remote) {
  const merged = new Map(remote.map(record => [record.id, record]));
  for (const record of local) {
    const other = merged.get(record.id);
    if (!other || record.pendingSync || (!record.revision && Date.parse(record.updatedAt) > Date.parse(other.updatedAt))) merged.set(record.id, record);
  }
  return [...merged.values()];
}
function recordContentMatches(a, b) {
  return Boolean(b) && a.type === b.type && Date.parse(a.timestamp) === Date.parse(b.timestamp)
    && (Date.parse(a.deletedAt) || 0) === (Date.parse(b.deletedAt) || 0) && a.amountCents === b.amountCents
    && ['quantity','unit','context','intensity'].every(key => (a.details?.[key] ?? null) === (b.details?.[key] ?? null));
}
function confirmPendingRecords(local, remote) {
  const merged = new Map(remote.map(record => [record.id, record]));
  for (const record of local) {
    const other = merged.get(record.id);
    if (recordContentMatches(record, other)) merged.set(record.id, { ...other, pendingSync: false });
    else merged.set(record.id, { ...record, pendingSync: true });
  }
  return [...merged.values()];
}
