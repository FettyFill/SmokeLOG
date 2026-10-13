'use strict';

const DB_NAME = 'smokelog-local-db';
const DB_VERSION = 1;
const STORE_NAME = 'events';
const MAX_RECENT_EVENTS = 10;

let database;
let events = [];
let activeRange = 'day';
let toastTimer;

const elements = {
  currentDate: document.getElementById('current-date'),
  todayTotal: document.getElementById('today-total'),
  todayTotalLabel: document.getElementById('today-total-label'),
  todayCigarettes: document.getElementById('today-cigarettes'),
  todayJoints: document.getElementById('today-joints'),
  periodLabel: document.getElementById('period-label'),
  periodTotal: document.getElementById('period-total'),
  periodCigarettes: document.getElementById('period-cigarettes'),
  periodJoints: document.getElementById('period-joints'),
  chartTitle: document.getElementById('chart-title'),
  chartSubtitle: document.getElementById('chart-subtitle'),
  chartTotalPill: document.getElementById('chart-total-pill'),
  chartBars: document.getElementById('chart-bars'),
  historyList: document.getElementById('history-list'),
  historyCount: document.getElementById('history-count'),
  historyFootnote: document.getElementById('history-footnote'),
  toast: document.getElementById('toast'),
  importFile: document.getElementById('import-file')
};

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('Questo browser non supporta l’archivio locale richiesto.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
    request.onsuccess = () => {
      database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
    request.onerror = () => reject(request.error || new Error('Impossibile aprire l’archivio locale.'));
    request.onblocked = () => reject(new Error('Chiudi eventuali altre schede di SmokeLog e riprova.'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Operazione non riuscita.'));
    transaction.onabort = () => reject(transaction.error || new Error('Operazione annullata.'));
  });
}

async function readAllEvents() {
  const tx = database.transaction(STORE_NAME, 'readonly');
  const done = transactionDone(tx);
  const request = tx.objectStore(STORE_NAME).getAll();
  const result = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error || new Error('Impossibile leggere lo storico.'));
  });
  await done;
  return result.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

async function persistEvent(event) {
  const tx = database.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).add(event);
  await transactionDone(tx);
}

async function removeEvent(id) {
  const tx = database.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).delete(id);
  await transactionDone(tx);
}

async function replaceAllEvents(importedEvents) {
  const tx = database.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  store.clear();
  for (const event of importedEvents) store.put(event);
  await transactionDone(tx);
}

async function clearAllEvents() {
  const tx = database.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).clear();
  await transactionDone(tx);
}

function makeId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, amount) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() + amount);
  return result;
}

function startOfRange(range, now = new Date()) {
  if (range === 'day') return startOfDay(now);
  if (range === 'week') return addDays(startOfDay(now), -6);
  if (range === 'month') return new Date(now.getFullYear(), now.getMonth(), 1);
  return new Date(now.getFullYear(), 0, 1);
}

function endOfRange(range, now = new Date()) {
  if (range === 'day' || range === 'week') return addDays(startOfDay(now), 1);
  if (range === 'month') return new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return new Date(now.getFullYear() + 1, 0, 1);
}

function withinRange(event, start, end) {
  const timestamp = new Date(event.timestamp).getTime();
  return Number.isFinite(timestamp) && timestamp >= start.getTime() && timestamp < end.getTime();
}

function countTypes(source) {
  let cigarettes = 0;
  let joints = 0;
  for (const event of source) {
    if (event.type === 'cigarette') cigarettes += 1;
    if (event.type === 'joint') joints += 1;
  }
  return { total: cigarettes + joints, cigarettes, joints };
}

function formatNumber(number) {
  return new Intl.NumberFormat('it-IT').format(number);
}

function capitalizeFirst(value) {
  return value ? value.charAt(0).toLocaleUpperCase('it-IT') + value.slice(1) : value;
}

function formatDateTime(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return 'Data non valida';
  return `${capitalizeFirst(date.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' }))} · ${date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;
}

function formatDateShort(date) {
  return date.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' });
}

function filterForRange(range, now = new Date()) {
  const start = startOfRange(range, now);
  const end = endOfRange(range, now);
  return events.filter(event => withinRange(event, start, end));
}

function createBucket(label, start, end, shortLabel = label) {
  return { label, shortLabel, start, end, count: 0 };
}

function makeBuckets(range, now = new Date()) {
  const today = startOfDay(now);
  if (range === 'day') {
    const buckets = [];
    for (let hour = 0; hour < 24; hour += 6) {
      const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), hour);
      const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), hour + 6);
      buckets.push(createBucket(`${String(hour).padStart(2, '0')}–${String(hour + 6).padStart(2, '0')}`, start, end));
    }
    return buckets;
  }
  if (range === 'week') {
    return Array.from({ length: 7 }, (_, index) => {
      const start = addDays(today, index - 6);
      const end = addDays(start, 1);
      const dayName = start.toLocaleDateString('it-IT', { weekday: 'short' }).replace('.', '');
      return createBucket(`${capitalizeFirst(dayName)} ${start.getDate()}`, start, end, `${capitalizeFirst(dayName)} ${start.getDate()}`);
    });
  }
  if (range === 'month') {
    const year = now.getFullYear();
    const month = now.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const buckets = [];
    for (let first = 1; first <= daysInMonth; first += 7) {
      const last = Math.min(first + 6, daysInMonth);
      buckets.push(createBucket(`${first}–${last}`, new Date(year, month, first), new Date(year, month, last + 1)));
    }
    return buckets;
  }
  return Array.from({ length: 12 }, (_, month) => {
    const start = new Date(now.getFullYear(), month, 1);
    const end = new Date(now.getFullYear(), month + 1, 1);
    const label = capitalizeFirst(start.toLocaleDateString('it-IT', { month: 'short' }).replace('.', ''));
    return createBucket(label, start, end, label);
  });
}

function renderChart(range, periodEvents, now = new Date()) {
  const buckets = makeBuckets(range, now);
  for (const bucket of buckets) {
    bucket.count = periodEvents.filter(event => withinRange(event, bucket.start, bucket.end)).length;
  }
  const maxCount = Math.max(1, ...buckets.map(bucket => bucket.count));
  elements.chartBars.replaceChildren();

  for (const bucket of buckets) {
    const row = document.createElement('div');
    row.className = 'chart-row';
    const label = document.createElement('span');
    label.className = 'chart-label';
    label.textContent = bucket.label;
    const track = document.createElement('div');
    track.className = 'bar-track';
    track.setAttribute('aria-label', `${bucket.label}: ${bucket.count}`);
    const fill = document.createElement('div');
    fill.className = 'bar-fill';
    fill.style.width = `${bucket.count === 0 ? 0 : Math.max(5, (bucket.count / maxCount) * 100)}%`;
    track.append(fill);
    const count = document.createElement('span');
    count.className = 'chart-count';
    count.textContent = String(bucket.count);
    row.append(label, track, count);
    elements.chartBars.append(row);
  }

  const titles = {
    day: ['Distribuzione di oggi', 'Per fascia oraria'],
    week: ['Ultimi sette giorni', 'Registrazioni per giorno'],
    month: ['Andamento del mese', 'Registrazioni per settimana del mese'],
    year: ['Andamento dell’anno', 'Registrazioni per mese']
  };
  elements.chartTitle.textContent = titles[range][0];
  elements.chartSubtitle.textContent = titles[range][1];
  elements.chartTotalPill.textContent = `${formatNumber(periodEvents.length)} totali`;
  if (periodEvents.length === 0) {
    const note = document.createElement('p');
    note.className = 'chart-empty-note';
    note.textContent = 'Nessuna registrazione in questo periodo. Il grafico si aggiornerà quando aggiungerai un evento.';
    elements.chartBars.append(note);
  }
}

function renderHistory() {
  const sorted = [...events].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const visible = sorted.slice(0, MAX_RECENT_EVENTS);
  elements.historyList.replaceChildren();
  elements.historyCount.textContent = `${formatNumber(events.length)} ${events.length === 1 ? 'evento' : 'eventi'}`;
  elements.historyFootnote.textContent = events.length > MAX_RECENT_EVENTS
    ? `Mostrate le ${MAX_RECENT_EVENTS} registrazioni più recenti su ${formatNumber(events.length)}. Esporta un CSV per consultare l’intero storico.`
    : 'Puoi rimuovere una registrazione con il pulsante − accanto all’evento.';

  if (visible.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const icon = document.createElement('span');
    icon.className = 'empty-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '＋';
    const title = document.createElement('strong');
    title.textContent = 'Ancora nessuna registrazione';
    const description = document.createElement('p');
    description.textContent = 'Quando aggiungerai una sigaretta o una canna, la troverai qui.';
    empty.append(icon, title, description);
    elements.historyList.append(empty);
    return;
  }

  for (const event of visible) {
    const isCigarette = event.type === 'cigarette';
    const row = document.createElement('div');
    row.className = 'history-item';
    const icon = document.createElement('span');
    icon.className = `history-type-icon ${isCigarette ? 'cigarette' : 'joint'}`;
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = isCigarette ? '↗' : '✳';
    const main = document.createElement('div');
    main.className = 'history-item-main';
    const title = document.createElement('p');
    title.className = 'history-item-title';
    title.textContent = isCigarette ? 'Sigaretta' : 'Canna';
    const date = document.createElement('p');
    date.className = 'history-item-date';
    date.textContent = formatDateTime(event.timestamp);
    main.append(title, date);
    const remove = document.createElement('button');
    remove.className = 'delete-event';
    remove.type = 'button';
    remove.textContent = '−';
    remove.setAttribute('aria-label', `Elimina registrazione: ${isCigarette ? 'sigaretta' : 'canna'}, ${formatDateTime(event.timestamp)}`);
    remove.addEventListener('click', () => handleDeleteEvent(event));
    row.append(icon, main, remove);
    elements.historyList.append(row);
  }
}

function render() {
  const now = new Date();
  elements.currentDate.textContent = capitalizeFirst(now.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
  const todayEvents = filterForRange('day', now);
  const todayCounts = countTypes(todayEvents);
  elements.todayTotal.textContent = formatNumber(todayCounts.total);
  elements.todayTotalLabel.textContent = todayCounts.total === 1 ? 'registrazione' : 'registrazioni';
  elements.todayCigarettes.textContent = formatNumber(todayCounts.cigarettes);
  elements.todayJoints.textContent = formatNumber(todayCounts.joints);

  const labels = { day: 'Totale di oggi', week: 'Totale ultimi 7 giorni', month: 'Totale del mese', year: 'Totale dell’anno' };
  const periodEvents = filterForRange(activeRange, now);
  const counts = countTypes(periodEvents);
  elements.periodLabel.textContent = labels[activeRange];
  elements.periodTotal.textContent = formatNumber(counts.total);
  elements.periodCigarettes.textContent = formatNumber(counts.cigarettes);
  elements.periodJoints.textContent = formatNumber(counts.joints);
  renderChart(activeRange, periodEvents, now);
  renderHistory();
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add('is-visible');
  toastTimer = window.setTimeout(() => elements.toast.classList.remove('is-visible'), 2500);
}

async function handleAddEvent(type) {
  try {
    const event = { id: makeId(), type, timestamp: new Date().toISOString() };
    await persistEvent(event);
    events.push(event);
    events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    render();
    showToast(type === 'cigarette' ? 'Sigaretta registrata.' : 'Canna registrata.');
  } catch (error) {
    console.error(error);
    showToast('Non sono riuscito a salvare. Esporta o verifica i dati del browser.');
  }
}

async function handleDeleteEvent(event) {
  const typeLabel = event.type === 'cigarette' ? 'la sigaretta' : 'la canna';
  if (!window.confirm(`Vuoi eliminare ${typeLabel} registrata il ${formatDateTime(event.timestamp)}?`)) return;
  try {
    await removeEvent(event.id);
    events = events.filter(item => item.id !== event.id);
    render();
    showToast('Registrazione eliminata.');
  } catch (error) {
    console.error(error);
    showToast('Non è stato possibile eliminare la registrazione.');
  }
}

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
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    events: [...events].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
  };
  downloadFile(`smokelog-backup-${localDateKey(new Date())}.json`, JSON.stringify(backup, null, 2), 'application/json;charset=utf-8');
  showToast('Backup JSON preparato. Salvalo in un luogo sicuro.');
}

function csvEscape(value) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function exportCsv() {
  const rows = [['id', 'tipo', 'data_ora_iso', 'data_locale', 'ora_locale']];
  const sorted = [...events].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  for (const event of sorted) {
    const date = new Date(event.timestamp);
    rows.push([
      event.id,
      event.type === 'cigarette' ? 'Sigaretta' : 'Canna',
      event.timestamp,
      date.toLocaleDateString('it-IT'),
      date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
    ]);
  }
  const csv = '\uFEFF' + rows.map(row => row.map(csvEscape).join(';')).join('\r\n');
  downloadFile(`smokelog-storico-${localDateKey(new Date())}.csv`, csv, 'text/csv;charset=utf-8');
  showToast('CSV preparato per il salvataggio o l’apertura in un foglio di calcolo.');
}

function validateBackup(parsed) {
  if (!parsed || parsed.app !== 'SmokeLog' || parsed.schemaVersion !== 1 || !Array.isArray(parsed.events)) {
    throw new Error('Il file non sembra un backup SmokeLog valido.');
  }
  const seen = new Set();
  const validated = [];
  for (const item of parsed.events) {
    if (!item || typeof item.id !== 'string' || !['cigarette', 'joint'].includes(item.type) || typeof item.timestamp !== 'string' || !Number.isFinite(Date.parse(item.timestamp))) {
      throw new Error('Il backup contiene una registrazione non valida. Nessun dato è stato modificato.');
    }
    let id = item.id;
    if (seen.has(id)) id = makeId();
    seen.add(id);
    validated.push({ id, type: item.type, timestamp: new Date(item.timestamp).toISOString() });
  }
  return validated;
}

async function importJsonFile(file) {
  if (!file) return;
  try {
    const raw = await file.text();
    const parsed = JSON.parse(raw);
    const validated = validateBackup(parsed);
    const approved = window.confirm(`Il backup contiene ${validated.length} registrazioni. Importandolo, lo storico attuale verrà sostituito. Prima di continuare, esporta un backup se vuoi conservare i dati attuali. Procedere?`);
    if (!approved) return;
    await replaceAllEvents(validated);
    events = await readAllEvents();
    render();
    showToast(`Importate ${validated.length} registrazioni.`);
  } catch (error) {
    console.error(error);
    window.alert(error instanceof SyntaxError ? 'Il file scelto non è un JSON valido.' : (error.message || 'Importazione non riuscita.'));
  } finally {
    elements.importFile.value = '';
  }
}

async function handleClearData() {
  if (events.length === 0) {
    showToast('Non ci sono registrazioni da eliminare.');
    return;
  }
  const approved = window.confirm(`Stai per eliminare tutte le ${events.length} registrazioni salvate su questo dispositivo. L’azione non si può annullare. Hai già esportato un backup, se necessario?`);
  if (!approved) return;
  try {
    await clearAllEvents();
    events = [];
    render();
    showToast('Storico eliminato.');
  } catch (error) {
    console.error(error);
    showToast('Non è stato possibile eliminare lo storico.');
  }
}

function setupEventHandlers() {
  document.getElementById('add-cigarette').addEventListener('click', () => handleAddEvent('cigarette'));
  document.getElementById('add-joint').addEventListener('click', () => handleAddEvent('joint'));
  document.querySelectorAll('[data-range]').forEach(button => {
    button.addEventListener('click', () => {
      activeRange = button.dataset.range;
      document.querySelectorAll('[data-range]').forEach(option => {
        const selected = option === button;
        option.classList.toggle('is-active', selected);
        option.setAttribute('aria-pressed', String(selected));
      });
      render();
    });
  });
  document.getElementById('export-json').addEventListener('click', exportJson);
  document.getElementById('export-csv').addEventListener('click', exportCsv);
  document.getElementById('import-json').addEventListener('click', () => elements.importFile.click());
  elements.importFile.addEventListener('change', () => importJsonFile(elements.importFile.files && elements.importFile.files[0]));
  document.getElementById('clear-data').addEventListener('click', handleClearData);
}

async function init() {
  setupEventHandlers();
  try {
    await openDatabase();
    events = await readAllEvents();
    render();
  } catch (error) {
    console.error(error);
    window.alert(`SmokeLog non riesce ad aprire l’archivio locale. Prova con una versione recente di Safari o di un browser compatibile. Dettaglio: ${error.message || 'errore sconosciuto'}`);
  }

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('./service-worker.js').catch(error => console.warn('Service worker non registrato:', error));
  }
}

document.addEventListener('DOMContentLoaded', init);
