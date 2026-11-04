function createTimestampEditButton(kind, record, label) {
  const button = document.createElement('button');
  button.className = 'edit-timestamp';
  button.type = 'button';
  button.textContent = 'Modifica';
  button.setAttribute('aria-label', `Modifica: ${label}, ${formatDateTime(record.timestamp)}`);
  button.addEventListener('click', () => openTimestampDialog(kind, record));
  return button;
}

function renderHistory() {
  const now = new Date();
  const rangeStart = historyRangeFilter === 'all' ? null : startOfRange(historyRangeFilter, now);
  const rangeEnd = historyRangeFilter === 'all' ? null : endOfRange(historyRangeFilter, now);
  const records = [
    ...events.map(record => ({ ...record, kind: 'event' })),
    ...purchases.map(record => ({ ...record, kind: 'purchase' }))
  ].filter(record => historyKindFilter === 'all' || record.kind === historyKindFilter)
    .filter(record => !rangeStart || withinRange(record, rangeStart, rangeEnd))
    .sort((first, second) => new Date(second.timestamp) - new Date(first.timestamp));
  const visible = records.slice(0, historyVisibleCount);
  elements.historyList.replaceChildren();
  elements.historyCount.textContent = `${formatNumber(records.length)} attività`;
  elements.historyFootnote.textContent = records.length > visible.length
    ? `Mostrate ${formatNumber(visible.length)} di ${formatNumber(records.length)} attività.`
    : 'Puoi modificare o rimuovere ogni attività.';
  const remaining = records.length - visible.length;
  elements.historyLoadMore.hidden = remaining <= 0;
  elements.historyLoadMore.textContent = remaining > 0
    ? `Mostra altre ${formatNumber(Math.min(HISTORY_PAGE_SIZE, remaining))}`
    : 'Mostra altre attività';

  if (visible.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const icon = document.createElement('span');
    icon.className = 'empty-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '＋';
    const title = document.createElement('strong');
    title.textContent = records.length === 0 ? 'Nessuna attività in questo periodo' : 'Ancora nessuna attività';
    const description = document.createElement('p');
    description.textContent = 'Le registrazioni e le spese compariranno qui.';
    empty.append(icon, title, description);
    elements.historyList.append(empty);
    return;
  }

  for (const record of visible) {
    const isPurchase = record.kind === 'purchase';
    const label = isPurchase ? (PURCHASE_LABELS[record.type] || 'Acquisto') : eventLabel(record.type);
    const row = document.createElement('div');
    row.className = `history-item${isPurchase ? ` purchase-history-item expense-${record.type}` : ''}`;
    const icon = document.createElement('span');
    icon.className = `history-type-icon${isPurchase ? ' purchase-history-icon' : ` ${record.type}`}`;
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = isPurchase
      ? '€'
      : record.type === 'cigarette' || record.type === 'half-cigarette' ? '↗' : record.type === 'puff' ? '▱' : '✳';
    const main = document.createElement('div');
    main.className = 'history-item-main';
    const title = document.createElement('p');
    title.className = 'history-item-title';
    title.textContent = label + (!isPurchase && record.details?.quantity ? ` · ${record.details.quantity} ${record.details.unit || 'unità'}` : '');
    const date = document.createElement('p');
    date.className = 'history-item-date';
    date.textContent = formatDateTime(record.timestamp) + (record.details?.context ? ` · ${record.details.context}` : '');
    main.append(title, date);
    if (isPurchase) {
      const amount = document.createElement('strong');
      amount.className = 'purchase-history-amount';
      amount.textContent = formatCurrency(record.amountCents);
      row.append(icon, main, amount, createTimestampEditButton('purchase', record, label));
    } else {
      row.append(icon, main, createTimestampEditButton('event', record, label));
    }
    const remove = document.createElement('button');
    remove.className = 'delete-event';
    remove.type = 'button';
    remove.textContent = '−';
    remove.setAttribute('aria-label', `Elimina ${isPurchase ? 'spesa' : 'registrazione'}: ${label}, ${formatDateTime(record.timestamp)}`);
    remove.addEventListener('click', () => {
      if (isPurchase) void handleDeletePurchase(record);
      else void handleDeleteEvent(record);
    });
    row.append(remove);
    elements.historyList.append(row);
  }
}

function renderWeeklyInsights(now = new Date()) {
  const isWeekly = activeRange === 'week';
  elements.weeklyInsights.hidden = !isWeekly;
  if (!isWeekly) return;

  const currentStart = startOfRange('week', now);
  const currentEnd = endOfRange('week', now);
  const previousStart = addDays(currentStart, -7);
  const currentEvents = events.filter(event => withinRange(event, currentStart, currentEnd));
  const previousEvents = events.filter(event => withinRange(event, previousStart, currentStart));
  const currentPurchases = purchases.filter(purchase => withinRange(purchase, currentStart, currentEnd));
  const currentSpend = currentPurchases.reduce((total, purchase) => total + purchase.amountCents, 0);

  elements.weeklyTotal.textContent = formatNumber(currentEvents.length);
  elements.weeklySpend.textContent = formatCurrency(currentSpend);
  const complete = Array.from({length:14}, (_, i) => readWellness().payload.confirmedDays[localDateKey(addDays(now, -i))]).every(Boolean);
  elements.weeklyDailySpend.textContent = complete ? `${formatCurrency(Math.round(currentSpend / 7))} al giorno` : 'Copertura incompleta';
  if (!complete) elements.weeklyChange.textContent = 'Conferma le giornate per confrontare i periodi';
  else if (previousEvents.length === 0) {
    elements.weeklyChange.textContent = currentEvents.length === 0
      ? 'Nessun dato nei periodi confrontati'
      : 'Nuove registrazioni rispetto al periodo precedente';
  } else {
    const difference = Math.round(((currentEvents.length - previousEvents.length) / previousEvents.length) * 100);
    const direction = difference < 0 ? 'in meno' : difference > 0 ? 'in più' : 'in linea';
    elements.weeklyChange.textContent = `${Math.abs(difference)}% ${direction} rispetto ai 7 giorni precedenti`;
  }

  const timeCounts = Array(4).fill(0);
  const weekdayCounts = Array(7).fill(0);
  for (const event of currentEvents) {
    const date = new Date(event.timestamp);
    if (!Number.isFinite(date.getTime())) continue;
    timeCounts[Math.floor(date.getHours() / 6)] += 1;
    weekdayCounts[date.getDay()] += 1;
  }
  const peakTime = Math.max(...timeCounts);
  const peakDay = Math.max(...weekdayCounts);
  elements.weeklyPeakTime.textContent = peakTime === 0
    ? '—'
    : `${String(timeCounts.indexOf(peakTime) * 6).padStart(2, '0')}–${String(timeCounts.indexOf(peakTime) * 6 + 6).padStart(2, '0')}`;
  elements.weeklyPeakDay.textContent = peakDay === 0
    ? '—'
    : capitalizeFirst(new Intl.DateTimeFormat('it-IT', { weekday: 'long' }).format(new Date(2024, 0, 7 + weekdayCounts.indexOf(peakDay))));
}

