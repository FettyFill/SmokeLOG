const WELLNESS_KEY = 'smokelog-wellness-v1:';
function validateRecordDetails(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Dettagli della registrazione non validi.');
  if (value.quantity !== undefined && (!Number.isFinite(value.quantity) || value.quantity <= 0 || value.quantity > 10000)) throw new Error('Quantità non valida.');
  if (value.unit !== undefined && !['unità','g','ml','tiri'].includes(value.unit)) throw new Error('Unità non valida.');
  if (value.context !== undefined && (typeof value.context !== 'string' || value.context.length > 80)) throw new Error('Contesto non valido.');
  if (value.intensity != null && (!Number.isInteger(value.intensity) || value.intensity < 1 || value.intensity > 5)) throw new Error('Intensità non valida.');
  return { ...value };
}
function emptyWellness() {
  return { startedOn: localDateKey(new Date()), purpose: 'observe', confirmedDays: {}, cravings: [], experiment: '', reminder: '' };
}
function readWellness(owner = activeOwnerId) {
  try {
    const stored = JSON.parse(localStorage.getItem(WELLNESS_KEY + owner));
    if (stored) return stored;
    const legacy = JSON.parse(localStorage.getItem('smokelog-goals-v1:' + owner) || 'null');
    const state = { revision: '0', pending: Boolean(legacy), payload: { ...emptyWellness(), ...(legacy ? {goals:legacy} : {}) } };
    localStorage.setItem(WELLNESS_KEY + owner, JSON.stringify(state));
    return state;
  }
  catch { throw new Error('Le preferenze locali non sono leggibili. Esporta un backup prima di riprovare.'); }
}
function validateWellness(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value.startedOn) || !Number.isFinite(Date.parse(value.startedOn))
      || !['observe', 'reduce', 'quit'].includes(value.purpose) || !Array.isArray(value.cravings)
      || value.cravings.length > 10000 || !value.confirmedDays || typeof value.confirmedDays !== 'object'
      || Array.isArray(value.confirmedDays) || typeof value.experiment !== 'string' || value.experiment.length > 240
      || typeof value.reminder !== 'string' || (value.reminder && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.reminder))) throw new Error('Dati di consapevolezza non validi.');
  for (const [date, confirmed] of Object.entries(value.confirmedDays)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || confirmed !== true) throw new Error('Giornata confermata non valida.');
  }
  for (const entry of value.cravings) {
    if (!entry || typeof entry.id !== 'string' || !Number.isFinite(Date.parse(entry.timestamp))
      || !Number.isInteger(entry.intensity) || entry.intensity < 1 || entry.intensity > 5
      || typeof entry.context !== 'string' || entry.context.length > 80) throw new Error('Voce del diario non valida.');
  }
  if (value.goals) SmokeLogInsights.validateGoals(value.goals);
  return structuredClone(value);
}
function saveWellness(payload, owner = activeOwnerId) {
  const state = readWellness(owner);
  localStorage.setItem(WELLNESS_KEY + owner, JSON.stringify({ ...state, payload: validateWellness(payload), pending: true }));
  markLocalMutation();
  requestCloudSync();
}
function invalidateConfirmedDaysForRecords(records, owner = activeOwnerId) {
  const state = readWellness(owner).payload;
  const affectedDays = [...new Set(records
    .map(record => new Date(record.timestamp))
    .filter(date => Number.isFinite(date.getTime()))
    .map(localDateKey))];
  const invalidatedDays = affectedDays.filter(date => state.confirmedDays[date]);
  if (!invalidatedDays.length) return [];
  const confirmedDays = { ...state.confirmedDays };
  for (const date of invalidatedDays) delete confirmedDays[date];
  saveWellness({ ...state, confirmedDays }, owner);
  return invalidatedDays;
}
function confirmedDaysReviewMessage(dates) {
  if (!dates.length) return '';
  if (dates.length > 2) return ` ${dates.length} giornate da rivedere e riconfermare.`;
  const labels = dates.map(value => {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
  });
  return ` Giornata${labels.length === 1 ? '' : 'e'} ${labels.join(', ')} da rivedere e riconfermare.`;
}
async function syncWellness(owner) {
  let local = readWellness(owner);
  let before = localStorage.getItem(WELLNESS_KEY + owner);
  const rows = await supabaseRequest('smokelog_wellness?select=payload,revision');
  const remote = rows[0];
  if (remote && local.pending && canonicalJson(remote.payload) === canonicalJson(local.payload)
      && localStorage.getItem(WELLNESS_KEY + owner) === before) {
    localStorage.setItem(WELLNESS_KEY + owner, JSON.stringify({ payload: local.payload, revision: String(remote.revision), pending: false }));
    return;
  }
  if (!remote && !local.pending && owner !== GUEST_OWNER_ID) {
    const guest = readWellness(GUEST_OWNER_ID);
    if (guest.pending) {
      local = { ...local, payload: guest.payload, pending: true };
      before = JSON.stringify(local); localStorage.setItem(WELLNESS_KEY + owner, before);
      goalsFormOwner = null; wellnessFormOwner = null;
    }
  }
  if (local.pending) {
    if (String(remote?.revision || '0') !== String(local.revision)) {
      throw new Error('Obiettivi o diario modificati su un altro dispositivo. Apri Consapevolezza e scegli quale versione conservare.');
    }
    const result = await supabaseRequest('rpc/save_smokelog_wellness', { method: 'POST', body: JSON.stringify({ p_revision: local.revision, p_payload: local.payload }) });
    if (localStorage.getItem(WELLNESS_KEY + owner) === before) {
      localStorage.setItem(WELLNESS_KEY + owner, JSON.stringify({ payload: local.payload, revision: String(result), pending: false }));
    } else {
      const latest = readWellness(owner);
      localStorage.setItem(WELLNESS_KEY + owner, JSON.stringify({ ...latest, revision: String(result), pending: true }));
      cloudSyncNeedsAnotherPass = true;
    }
  } else if (remote && localStorage.getItem(WELLNESS_KEY + owner) === before) {
    localStorage.setItem(WELLNESS_KEY + owner, JSON.stringify({ payload: validateWellness(remote.payload), revision: String(remote.revision), pending: false }));
    goalsFormOwner = null;
    wellnessFormOwner = null;
  }
}
function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
