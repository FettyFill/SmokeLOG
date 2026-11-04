function openCategoryDetails(kind, type) {
  const labels = kind === 'event'
    ? Object.fromEntries(categories.map(category => [category.id, category.name]))
    : PURCHASE_LABELS;
  if (!Object.hasOwn(labels, type)) return;
  activeCategoryDetails = { kind, type };
  renderCategoryDetails();
  elements.categoryDetailsDialog.showModal();
}

function renderCategoryDetails() {
  if (!activeCategoryDetails) return;
  const { kind, type } = activeCategoryDetails;
  const labels = kind === 'event'
    ? Object.fromEntries(categories.map(category => [category.id, category.name]))
    : PURCHASE_LABELS;
  const rangeLabels = { day: 'oggi', week: 'negli ultimi 7 giorni', month: 'nel mese', year: 'nell’anno' };
  const now = new Date();
  const rangeStart = startOfRange(activeRange, now);
  const rangeEnd = endOfRange(activeRange, now);
  const records = (kind === 'event' ? events : purchases)
    .filter(record => record.type === type && withinRange(record, rangeStart, rangeEnd))
    .sort((first, second) => new Date(second.timestamp) - new Date(first.timestamp));

  elements.categoryDetailsTitle.textContent = labels[type];
  elements.categoryDetailsDescription.textContent = `${formatNumber(records.length)} ${kind === 'event' ? (records.length === 1 ? 'registrazione' : 'registrazioni') : (records.length === 1 ? 'acquisto' : 'acquisti')} ${rangeLabels[activeRange]}.`;
  elements.categoryDetailsList.replaceChildren();
  if (records.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'category-details-empty';
    empty.textContent = `Nessun elemento di questa categoria ${rangeLabels[activeRange]}.`;
    elements.categoryDetailsList.append(empty);
    return;
  }

  for (const record of records) {
    const row = document.createElement('div');
    row.className = 'category-details-item';
    const details = document.createElement('div');
    details.className = 'category-details-item-main';
    const date = document.createElement('p');
    date.className = 'history-item-date';
    date.textContent = formatDateTime(record.timestamp);
    details.append(date);
    if (kind === 'purchase') {
      const amount = document.createElement('strong');
      amount.className = 'purchase-history-amount';
      amount.textContent = formatCurrency(record.amountCents);
      details.append(amount);
    }
    const remove = document.createElement('button');
    remove.className = 'delete-event';
    remove.type = 'button';
    remove.textContent = '−';
    const itemDescription = kind === 'event'
      ? `${labels[type]}, ${formatDateTime(record.timestamp)}`
      : `${labels[type]}, ${formatCurrency(record.amountCents)}, ${formatDateTime(record.timestamp)}`;
    remove.setAttribute('aria-label', `Elimina ${kind === 'event' ? 'registrazione' : 'acquisto'}: ${itemDescription}`);
    const editTimestamp = createTimestampEditButton(kind, record, labels[type]);
    remove.addEventListener('click', () => {
      if (kind === 'event') void handleDeleteEvent(record);
      else void handleDeletePurchase(record);
    });
    row.append(details, editTimestamp, remove);
    elements.categoryDetailsList.append(row);
  }
}

function suspendCategoryDetails() {
  if (!elements.categoryDetailsDialog.open || !activeCategoryDetails) return null;
  const details = activeCategoryDetails;
  elements.categoryDetailsDialog.close();
  return details;
}

function resumeCategoryDetails(details) {
  if (!details || elements.categoryDetailsDialog.open) return;
  activeCategoryDetails = details;
  renderCategoryDetails();
  elements.categoryDetailsDialog.showModal();
}

function openTimestampDialog(kind, record) {
  if (elements.timestampDialog.open) return;
  const labels = kind === 'event'
    ? Object.fromEntries(categories.map(category => [category.id, category.name]))
    : PURCHASE_LABELS;
  const categoryDetails = suspendCategoryDetails();
  activeTimestampEdit = { kind, id: record.id, categoryDetails, owner: activeOwnerId };
  elements.timestampDialogTitle.textContent = labels[record.type] || 'Registrazione';
  elements.timestampDialogEyebrow.textContent = kind === 'event' ? 'MODIFICA REGISTRAZIONE' : 'MODIFICA ACQUISTO';
  const localValue = toDateTimeLocalValue(record.timestamp);
  elements.timestampDate.value = localValue.slice(0, 10);
  elements.timestampDate.max = localDateKey(new Date());
  elements.timestampTime.value = localValue.slice(11, 16);
  elements.timestampFormError.hidden = true;
  elements.timestampSave.disabled = false;
  setupRecordFields(kind, record);
  elements.timestampDialog.showModal();
  window.requestAnimationFrame(() => elements.timestampDate.focus());
}

async function saveTimestampEdit() {
  if (!activeTimestampEdit) return;
  if (activeTimestampEdit.owner !== activeOwnerId) { elements.timestampDialog.close(); showToast('Archivio cambiato. Riapri la voce da modificare.', 'info'); return; }
  if (!elements.timestampDate.value || !elements.timestampDate.checkValidity()
    || !elements.timestampTime.value || !elements.timestampTime.checkValidity()) {
    elements.timestampFormError.textContent = 'Inserisci una data valida e un orario nel formato 24 ore (00:00–23:59).';
    elements.timestampFormError.hidden = false;
    if (!elements.timestampDate.value || !elements.timestampDate.checkValidity()) elements.timestampDate.reportValidity();
    else elements.timestampTime.reportValidity();
    return;
  }
  const [year, month, day] = elements.timestampDate.value.split('-').map(Number);
  const [hour, minute] = elements.timestampTime.value.split(':').map(Number);
  const date = new Date(year, month - 1, day, hour, minute);
  if (!Number.isFinite(date.getTime()) || date.getTime() > Date.now() || date.getFullYear() !== year
    || date.getMonth() !== month - 1 || date.getDate() !== day
    || date.getHours() !== hour || date.getMinutes() !== minute) {
    elements.timestampFormError.textContent = 'La data e l’orario inseriti non sono validi.';
    elements.timestampFormError.hidden = false;
    return;
  }

  const { kind, id, categoryDetails } = activeTimestampEdit;
  if (id === null && kind === 'event') {
    try {
      const fields = readRecordFields(kind);
      elements.timestampSave.disabled = true;
      const saved = await handleAddEvent(fields.type, { details: fields.details, timestamp: date.toISOString() });
      if (saved) { activeTimestampEdit = null; elements.timestampDialog.close(); }
    } catch (error) {
      elements.timestampFormError.textContent = error.message; elements.timestampFormError.hidden = false;
    } finally { elements.timestampSave.disabled = false; }
    return;
  }
  const records = kind === 'event' ? events : purchases;
  const currentRecord = records.find(record => record.id === id);
  if (!currentRecord) {
    elements.timestampFormError.textContent = 'Questa voce non è più presente nello storico. Chiudi e aggiorna la pagina.';
    elements.timestampFormError.hidden = false;
    return;
  }

  let detail;
  try { detail = readRecordFields(kind); }
  catch (error) { elements.timestampFormError.textContent = error.message; elements.timestampFormError.hidden = false; return; }
  const updatedRecord = {
    ...currentRecord,
    ...detail,
    pendingSync: true,
    timestamp: date.toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null
  };
  elements.timestampSave.disabled = true;
  elements.timestampFormError.hidden = true;
  let invalidatedDays = [];
  try {
    invalidatedDays = invalidateConfirmedDaysForRecords([currentRecord, updatedRecord]);
    if (kind === 'event') {
      await updateStoredEvent(updatedRecord);
      events = events.map(record => record.id === id ? updatedRecord : record)
        .sort((first, second) => new Date(second.timestamp) - new Date(first.timestamp));
    } else {
      await updateStoredPurchase(updatedRecord);
      purchases = purchases.map(record => record.id === id ? updatedRecord : record)
        .sort((first, second) => new Date(second.timestamp) - new Date(first.timestamp));
    }
    markLocalMutation();

    activeTimestampEdit = null;
    elements.timestampDialog.close();
    render();
    resumeCategoryDetails(categoryDetails);
    showToast(`Registrazione aggiornata.${confirmedDaysReviewMessage(invalidatedDays)}`, invalidatedDays.length ? 'info' : 'success');
    requestCloudSync();
  } catch (error) {
    console.error(error);
    if (invalidatedDays.length) render();
    elements.timestampSave.disabled = false;
    const detail = error instanceof Error && error.message ? ` ${error.message}` : '';
    elements.timestampFormError.textContent = `Non è stato possibile aggiornare la voce sul dispositivo.${detail}${confirmedDaysReviewMessage(invalidatedDays)}`;
    elements.timestampFormError.hidden = false;
  }
}

function showToast(message, type = 'success') {
  document.getElementById('toast-undo')?.remove();
  window.clearTimeout(toastTimer);
  const icons = { success: '✓', error: '!', info: 'i' };
  elements.toast.classList.remove('is-success', 'is-error', 'is-info');
  elements.toast.classList.add(`is-${type}`);
  elements.toastIcon.textContent = icons[type] || icons.info;
  elements.toastMessage.textContent = message;
  elements.toast.classList.add('is-visible');
  toastTimer = window.setTimeout(() => elements.toast.classList.remove('is-visible'), 3600);
}

function openActionDialog({ title, message, confirmLabel = 'Conferma', cancelLabel = 'Annulla', danger = false, notice = false }) {
  if (elements.actionDialog.open) return Promise.resolve(false);
  elements.actionDialogTitle.textContent = title;
  elements.actionDialogMessage.textContent = message;
  elements.actionDialogConfirm.textContent = notice ? 'Ho capito' : confirmLabel;
  elements.actionDialogCancel.textContent = cancelLabel;
  elements.actionDialogCancel.hidden = notice;
  elements.actionDialog.classList.toggle('is-danger', danger);
  elements.actionDialog.classList.toggle('is-notice', notice);
  elements.actionDialogEyebrow.textContent = danger ? 'CONFERMA AZIONE' : notice ? 'AVVISO' : 'SMOKELOG';
  elements.actionDialogIcon.textContent = danger ? '−' : notice ? 'i' : '✓';
  elements.actionDialog.showModal();

  return new Promise(resolve => {
    elements.actionDialog.addEventListener('close', () => {
      resolve(elements.actionDialog.returnValue === 'confirm');
    }, { once: true });
  });
}

async function handleAddEvent(type, detail = {}) {
  const category = categories.find(item => item.id === type && item.isActive);
  if (!category) {
    showToast('Questa categoria non è disponibile. Aggiorna lo storico e riprova.', 'error');
    return;
  }
  let invalidatedDays = [];
  try {
    const timestamp = detail.timestamp || new Date().toISOString();
    const event = { id: makeId(), type, ...detail, timestamp, updatedAt: new Date().toISOString(), deletedAt: null, pendingSync: true };
    invalidatedDays = invalidateConfirmedDaysForRecords([event]);
    await persistEvent(event);
    markLocalMutation();
    events.push(event);
    events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    render();
    showUndo(`${eventLabel(type)} registrata.${confirmedDaysReviewMessage(invalidatedDays)}`, "event", event);
    requestCloudSync();
    return true;
  } catch (error) {
    console.error(error);
    if (invalidatedDays.length) render();
    const detail = error instanceof Error && error.message ? ` ${error.message}` : '';
    showToast(`Registrazione non salvata sul dispositivo.${detail}${confirmedDaysReviewMessage(invalidatedDays)}`, 'error');
  }
}

function openPurchaseDialog() {
  const time = document.getElementById('purchase-timestamp');
  time.value = toDateTimeLocalValue(new Date().toISOString()); time.max = time.value;
  elements.purchaseType.value = '';
  elements.purchaseAmount.value = '';
  elements.purchaseAmount.setCustomValidity('');
  elements.purchaseFormError.hidden = true;
  elements.purchaseDialog.returnValue = '';
  elements.purchaseDialog.showModal();
  window.requestAnimationFrame(() => elements.purchaseType.focus());
  return new Promise(resolve => {
    elements.purchaseDialog.addEventListener('close', () => {
      const [type, amountText] = elements.purchaseDialog.returnValue.split(':');
      const amountCents = Number(amountText);
      resolve(Object.hasOwn(PURCHASE_LABELS, type) && Number.isSafeInteger(amountCents) && amountCents > 0
        ? { type, amountCents, timestamp: new Date(time.value).toISOString() }
        : null);
    }, { once: true });
  });
}

async function handleAddPurchase() {
  let invalidatedDays = [];
  try {
    const selection = await openPurchaseDialog();
    if (selection === null) return;
    const { type, amountCents, timestamp } = selection;
    const purchase = { id: makeId(), type, amountCents, timestamp, updatedAt: new Date().toISOString(), deletedAt: null, pendingSync: true };
    invalidatedDays = invalidateConfirmedDaysForRecords([purchase]);
    await persistPurchase(purchase);
    markLocalMutation();
    purchases.push(purchase);
    purchases.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    render();
    showUndo(`${PURCHASE_LABELS[type]} registrato: ${formatCurrency(amountCents)}.${confirmedDaysReviewMessage(invalidatedDays)}`, "purchase", purchase);
    requestCloudSync();
  } catch (error) {
    console.error(error);
    if (invalidatedDays.length) render();
    const detail = error instanceof Error && error.message ? ` ${error.message}` : '';
    showToast(`Spesa non salvata sul dispositivo.${detail}${confirmedDaysReviewMessage(invalidatedDays)}`, 'error');
  }
}

async function handleDeletePurchase(purchase) {
  const label = PURCHASE_LABELS[purchase.type] || 'Acquisto';
  const categoryDetails = suspendCategoryDetails();
  const approved = await openActionDialog({
    title: 'Eliminare questo acquisto?',
    message: `${label} · ${formatCurrency(purchase.amountCents)} · ${formatDateTime(purchase.timestamp)}. La spesa verrà rimossa dallo storico e sincronizzata quando possibile.`,
    confirmLabel: 'Sì, elimina',
    danger: true
  });
  if (!approved) {
    resumeCategoryDetails(categoryDetails);
    return;
  }
  let invalidatedDays = [];
  try {
    const deletedAt = new Date().toISOString();
    invalidatedDays = invalidateConfirmedDaysForRecords([purchase]);
    await updateStoredPurchase({ ...purchase, updatedAt: deletedAt, deletedAt });
    markLocalMutation();
    purchases = purchases.filter(item => item.id !== purchase.id);
    render();
    resumeCategoryDetails(categoryDetails);
    showToast(`Acquisto eliminato.${confirmedDaysReviewMessage(invalidatedDays)}`, invalidatedDays.length ? 'info' : 'success');
    requestCloudSync();
  } catch (error) {
    console.error(error);
    if (invalidatedDays.length) render();
    resumeCategoryDetails(categoryDetails);
    showToast(`Non è stato possibile eliminare l’acquisto.${confirmedDaysReviewMessage(invalidatedDays)}`, 'error');
  }
}

async function handleDeleteEvent(event) {
  const typeLabel = eventLabel(event.type);
  const categoryDetails = suspendCategoryDetails();
  const approved = await openActionDialog({
    title: 'Eliminare questa registrazione?',
    message: `${typeLabel} · ${formatDateTime(event.timestamp)}. La registrazione verrà rimossa dallo storico e sincronizzata quando possibile.`,
    confirmLabel: 'Sì, elimina',
    danger: true
  });
  if (!approved) {
    resumeCategoryDetails(categoryDetails);
    return;
  }
  let invalidatedDays = [];
  try {
    const deletedAt = new Date().toISOString();
    invalidatedDays = invalidateConfirmedDaysForRecords([event]);
    await updateStoredEvent({ ...event, updatedAt: deletedAt, deletedAt });
    markLocalMutation();
    events = events.filter(item => item.id !== event.id);
    render();
    resumeCategoryDetails(categoryDetails);
    showToast(`Registrazione eliminata.${confirmedDaysReviewMessage(invalidatedDays)}`, invalidatedDays.length ? 'info' : 'success');
    requestCloudSync();
  } catch (error) {
    console.error(error);
    if (invalidatedDays.length) render();
    resumeCategoryDetails(categoryDetails);
    showToast(`Non è stato possibile eliminare la registrazione.${confirmedDaysReviewMessage(invalidatedDays)}`, 'error');
  }
}
