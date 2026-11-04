function renderSyncBadge(text) {
  const node = document.getElementById('save-state');
  if (node) node.textContent = text;
}
function showUndo(message, kind, record) {
  showToast(message);
  window.clearTimeout(toastTimer);
  const owner = activeOwnerId;
  const button = document.createElement('button');
  button.id = 'toast-undo'; button.type = 'button'; button.textContent = 'Annulla';
  button.onclick = async () => {
    button.disabled = true;
    let invalidatedDays = [];
    try {
      if (owner !== activeOwnerId) throw new Error('Archivio cambiato: apri lo storico per correggere la voce.');
      const latest = (kind === 'event' ? await readAllEvents(owner, true) : await readAllPurchases(owner, true)).find(item => item.id === record.id);
      if (!latest || !recordContentMatches(record, latest)) throw new Error('La voce è cambiata: apri lo storico per modificarla.');
      const stamp = new Date().toISOString();
      const removed = { ...latest, updatedAt: stamp, deletedAt: stamp, pendingSync: true };
      invalidatedDays = invalidateConfirmedDaysForRecords([latest], owner);
      if (kind === 'event') { await updateStoredEvent(removed, owner); events = events.filter(item => item.id !== record.id); }
      else { await updateStoredPurchase(removed, owner); purchases = purchases.filter(item => item.id !== record.id); }
      markLocalMutation(); render(); requestCloudSync();
      showToast(`Registrazione annullata.${confirmedDaysReviewMessage(invalidatedDays)}`, invalidatedDays.length ? 'info' : 'success');
    } catch (error) {
      if (invalidatedDays.length) render();
      showToast(`${error.message}${confirmedDaysReviewMessage(invalidatedDays)}`, 'error');
    }
  };
  elements.toast.append(button);
  toastTimer = window.setTimeout(() => elements.toast.classList.remove('is-visible'), 8000);
}
function setupRecordFields(kind, record) {
  const root = document.getElementById('record-edit-fields');
  root.replaceChildren();
  const field = (text, node) => { const label = document.createElement('label'); label.textContent = text; label.append(node); root.append(label); return node; };
  const type = document.createElement('select'); type.id = 'edit-type';
  const labels = kind === 'event' ? Object.fromEntries(categories.map(c => [c.id, c.name])) : PURCHASE_LABELS;
  type.replaceChildren(...Object.entries(labels).map(([id, name]) => new Option(name, id)));
  type.value = record.type; field('Categoria', type);
  if (kind === 'purchase') {
    const amount = document.createElement('input'); amount.id = 'edit-amount'; amount.type = 'number'; amount.step = '0.01'; amount.min = '0.01'; amount.value = (record.amountCents / 100).toFixed(2); field('Importo · €', amount);
  } else {
    const quantity = document.createElement('input'); quantity.id = 'edit-quantity'; quantity.type = 'number'; quantity.min = '0.01'; quantity.max = '10000'; quantity.step = '0.01'; quantity.required = true; quantity.value = record.details?.quantity ?? ''; quantity.placeholder = 'Da specificare'; field('Quantità', quantity);
    const unit = document.createElement('select'); unit.id = 'edit-unit';
    unit.required = true;
    unit.replaceChildren(new Option('Seleziona unità', ''), ...['unità', 'g', 'ml', 'tiri'].map(name => new Option(name, name))); unit.value = record.details?.unit || ''; field('Unità (non convertita tra prodotti)', unit);
    const context = document.createElement('select'); context.id = 'edit-context';
    context.replaceChildren(...['', 'Abitudine', 'Stress', 'Socialità', 'Dopo pasto', 'Altro'].map(name => new Option(name || 'Non specificato', name))); context.value = record.details?.context || ''; field('Contesto facoltativo', context);
    const intensity = document.createElement('select'); intensity.id = 'edit-intensity';
    intensity.replaceChildren(new Option('Non specificata', ''), ...[1,2,3,4,5].map(n => new Option(String(n), String(n)))); intensity.value = record.details?.intensity || ''; field('Intensità della voglia · 1–5', intensity);
  }
}
function readRecordFields(kind) {
  const type = document.getElementById('edit-type').value;
  if (kind === 'purchase') {
    const amount = Number(document.getElementById('edit-amount').value);
    const amountCents = Math.round(amount * 100);
    if (Math.abs(amount * 100 - amountCents) > 0.00001) throw new Error('Usa al massimo due decimali per l’importo.');
    if (!Object.hasOwn(PURCHASE_LABELS, type) || !Number.isSafeInteger(amountCents) || amountCents < 1 || amountCents > 9999999999) throw new Error('Inserisci categoria e importo validi.');
    return { type, amountCents };
  }
  const quantity = Number(document.getElementById('edit-quantity').value);
  const unit = document.getElementById('edit-unit').value;
  if (!categories.some(c => c.id === type) || !Number.isFinite(quantity) || quantity <= 0 || quantity > 10000
    || !['unità', 'g', 'ml', 'tiri'].includes(unit)) throw new Error('Inserisci categoria, quantità e unità valide.');
  return { type, details: { quantity, unit,
    context: document.getElementById('edit-context').value, intensity: Number(document.getElementById('edit-intensity').value) || null } };
}
function setupEnhancements() {
  const actions = document.createElement('div'); actions.className = 'extra-actions';
  const add = document.createElement('button'); add.type = 'button'; add.className = 'secondary-button'; add.textContent = 'Aggiungi con dettagli o data passata';
  add.onclick = () => {
    const type = categories.find(c => c.isActive)?.id;
    if (!type) return;
    openTimestampDialog('event', { id: null, type, timestamp: new Date().toISOString() });
    elements.timestampDialogTitle.textContent = 'Nuova registrazione';
  };
  const badge = document.createElement('span'); badge.id = 'save-state'; badge.role = 'status'; badge.textContent = 'Sul dispositivo';
  const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'text-button'; retry.textContent = 'Sincronizza';
  retry.onclick = () => { if (!cloudSession) openAuthenticationModal(); else requestCloudSync(); };
  const conflicts = document.createElement('button'); conflicts.type = 'button'; conflicts.className = 'text-button'; conflicts.textContent = 'Risolvi conflitti';
  conflicts.onclick = () => resolveArchiveConflicts().catch(error => showToast(error.message, 'error'));
  actions.append(add, badge, retry, conflicts); elements.recordButtons.after(actions);
  const controls = document.getElementById('wellness-controls');
  controls.innerHTML = `<details><summary>Diario e percorso personale</summary>
    <p class="microcopy">Questa sezione raccoglie le tue preferenze e ti aiuta a osservare il percorso: non modifica automaticamente i consumi registrati né i calcoli.</p>
    <label>Il mio percorso<select id="wellness-purpose" required><option value="" disabled>Seleziona un’intenzione</option><option value="observe">Osservare</option><option value="reduce">Ridurre</option></select><small>Scegli l’intenzione personale che vuoi tenere a mente. Un programma dedicato a smettere non è disponibile in questa versione.</small></label>
    <p id="wellness-purpose-note" class="microcopy" role="status" hidden></p>
    <label>Inizio monitoraggio<input id="monitoring-start" type="date"><small>Da questa data puoi confermare le giornate; la copertura usa le conferme degli ultimi 28 giorni.</small></label>
    <label>Piccolo esperimento della settimana<input id="weekly-experiment" maxlength="240" placeholder="Es. osservare la voglia dopo il pasto"><small>La nota viene mostrata nel riepilogo, così puoi ricordare cosa vuoi osservare.</small></label>
    <label>Promemoria nell’app<input id="wellness-reminder" type="time"></label><small>Facoltativo: compare quando l’app è aperta. Svuota il campo per disattivarlo.</small>
    <button id="save-wellness" type="button" class="secondary-button">Salva percorso</button>
    <p class="microcopy"><strong>Conferma una giornata:</strong> indica che hai già inserito tutti i consumi e gli acquisti di quel giorno. La conferma serve a distinguere uno zero reale da dati mancanti e alimenta copertura, medie e confronti; non aggiunge una registrazione. Senza consumi, confermi una giornata a zero.</p>
    <label>Giorno da confermare<input id="confirm-day" type="date"></label><button id="confirm-day-button" type="button" class="secondary-button">Conferma diario completo</button><button id="unconfirm-day-button" type="button" class="text-button">Rimuovi conferma</button>
    <p class="microcopy"><strong>Annota una voglia senza consumo:</strong> registra il contesto e l’intensità da 1 a 5 per riconoscere eventuali ricorrenze. Non viene aggiunta ai consumi.</p>
    <label>Contesto della voglia<select id="craving-context"><option>Abitudine</option><option>Stress</option><option>Socialità</option><option>Dopo pasto</option><option>Altro</option></select></label>
    <label>Intensità della voglia<select id="craving-intensity"><option>1</option><option>2</option><option selected>3</option><option>4</option><option>5</option></select></label>
    <button id="save-craving" type="button" class="secondary-button">Registra voglia senza consumo</button><p class="microcopy"><strong>Voglie annotate:</strong> qui trovi le ultime annotazioni; puoi rimuoverle singolarmente.</p><div id="craving-history"></div>
    <p class="microcopy"><strong>Versioni del diario:</strong> se i dati sul dispositivo e quelli dell’account sono in conflitto, scegli quale conservare. La scelta sostituisce l’altra versione: esporta prima un backup se vuoi mantenerla.</p>
    <label>Versione del diario da conservare<select id="wellness-conflict-choice"><option value="device">Questo dispositivo</option><option value="cloud">Cloud</option></select></label>
    <button id="resolve-wellness" type="button" class="text-button">Risolvi conflitto del diario cloud</button>
    <p id="wellness-status" role="status"></p></details>`;
  const node = id => document.getElementById(id);
  node('confirm-day').value = localDateKey(new Date()); node('confirm-day').max = localDateKey(new Date());
  node('wellness-purpose').addEventListener('change', () => { node('wellness-purpose-note').hidden = true; });
  const act = (id, fn) => { node(id).onclick = async () => { try { await fn(); renderWellness(); } catch (error) { node('wellness-status').textContent = error.message; } }; };
  act('save-wellness', () => {
    const state = readWellness().payload;
    const startedOn = node('monitoring-start').value;
    if (!startedOn || startedOn > localDateKey(new Date())) throw new Error('Scegli una data di inizio non futura.');
    saveWellness({ ...state, purpose: node('wellness-purpose').value, startedOn, experiment: node('weekly-experiment').value.trim(), reminder: node('wellness-reminder').value }); renderInsights(); node('wellness-status').textContent = 'Percorso salvato.';
  });
  act('confirm-day-button', () => {
    const state = readWellness().payload, date = node('confirm-day').value;
    if (!date || date > localDateKey(new Date()) || date < state.startedOn) throw new Error('Scegli un giorno compreso nel monitoraggio.');
    saveWellness({ ...state, confirmedDays: { ...state.confirmedDays, [date]: true } }); renderInsights(); node('wellness-status').textContent = 'Giornata confermata.';
  });
  act('save-craving', () => {
    const state = readWellness().payload;
    saveWellness({ ...state, cravings: [...state.cravings, { id: makeId(), timestamp: new Date().toISOString(), context: node('craving-context').value, intensity: Number(node('craving-intensity').value) }] });
    node('wellness-status').textContent = 'Voglia registrata, senza aggiungere un consumo.';
  });
  act('unconfirm-day-button', () => {
    const state = readWellness().payload, confirmedDays = { ...state.confirmedDays };
    delete confirmedDays[node('confirm-day').value];
    saveWellness({ ...state, confirmedDays }); renderInsights(); node('wellness-status').textContent = 'Conferma rimossa.';
  });
  act('resolve-wellness', async () => {
    if (!cloudSession) throw new Error('Accedi prima al tuo account.');
    const owner = activeOwnerId;
    const rows = await supabaseRequest('smokelog_wellness?select=payload,revision');
    if (!rows[0]) throw new Error('Nessuna versione cloud disponibile.');
    const keep = node('wellness-conflict-choice').value === 'device';
    const approved = await openActionDialog({ title: 'Risolvi conflitto del diario', message: `Conservare la versione ${keep ? 'di questo dispositivo' : 'cloud'} di percorso, obiettivi, giorni confermati e voglie? Esporta prima un backup per conservare anche l’altra versione.`, confirmLabel: 'Conserva versione', cancelLabel: 'Annulla' });
    if (!approved) return;
    if (owner !== activeOwnerId) return;
    localStorage.setItem(WELLNESS_KEY + owner, JSON.stringify({ payload: keep ? readWellness(owner).payload : validateWellness(rows[0].payload), revision: String(rows[0].revision), pending: keep }));
    goalsFormOwner = null; wellnessFormOwner = null; render(); requestCloudSync();
  });
  window.addEventListener('online', requestCloudSync);
}
let wellnessFormOwner = null;
let lastReminder = '';
function renderWellness() {
  const node = id => document.getElementById(id);
  if (!node('wellness-purpose')) return;
  const state = readWellness().payload;
  if (wellnessFormOwner !== activeOwnerId) {
    node('wellness-purpose').value = state.purpose; node('wellness-purpose-note').hidden = state.purpose !== 'quit';
    node('wellness-purpose-note').textContent = state.purpose === 'quit'
      ? 'Il percorso “Smettere” salvato in precedenza non è disponibile in questa versione. Scegli Osservare o Ridurre per aggiornare la tua preferenza; i dati dello storico restano invariati.'
      : '';
    node('monitoring-start').value = state.startedOn;
    node('weekly-experiment').value = state.experiment; node('wellness-reminder').value = state.reminder; wellnessFormOwner = activeOwnerId;
  }
  node('craving-history').replaceChildren(...state.cravings.slice(-10).reverse().map(entry => {
    const row = document.createElement('p'); row.textContent = `${formatDateTime(entry.timestamp)} · ${entry.context} · ${entry.intensity}/5 `;
    const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Rimuovi';
    button.onclick = () => { try { const latest = readWellness().payload; saveWellness({ ...latest, cravings: latest.cravings.filter(item => item.id !== entry.id) }); renderWellness(); } catch (error) { showToast(error.message, 'error'); } };
    row.append(button); return row;
  }));
  const now = new Date(), key = activeOwnerId + localDateKey(now);
  if (state.reminder && toDateTimeLocalValue(now.toISOString()).slice(11,16) >= state.reminder && lastReminder !== key) {
    lastReminder = key; showToast('Un momento per te: aggiorna il diario o osserva come è andata la giornata.', 'info');
  }
}
function setupAppUpdates() {
  let reloading = false;
  const wasControlled = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (wasControlled && !reloading) { reloading = true; location.reload(); } });
  navigator.serviceWorker.register('./service-worker.js').then(registration => {
    const offer = () => {
      if (!registration.waiting || document.getElementById('app-update')) return;
      const button = document.createElement('button'); button.id = 'app-update'; button.className = 'update-banner'; button.textContent = 'Aggiornamento disponibile · Ricarica';
      button.onclick = () => registration.waiting?.postMessage({ type: 'ACTIVATE_UPDATE' }); document.body.append(button);
    };
    offer(); registration.addEventListener('updatefound', () => registration.installing?.addEventListener('statechange', offer));
  }).catch(error => console.warn('Service worker non registrato:', error));
}
