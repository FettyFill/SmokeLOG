let goalsFormOwner = null;
let goalsCategorySignature = '';
const GOALS_KEY = 'smokelog-goals-v1:';

function readGoals() {
  try {
    return SmokeLogInsights.validateGoals(readWellness().payload.goals || JSON.parse(localStorage.getItem(GOALS_KEY + activeOwnerId) || '{}'));
  } catch (error) {
    return SmokeLogInsights.validateGoals({});
  }
}

function renderInsights(now = new Date()) {
  const goals = readGoals();
  const node = id => document.getElementById(id);
  const signature = JSON.stringify(categories.map(({ id, name }) => [id, name]));
  const ownerChanged = goalsFormOwner !== activeOwnerId;
  if (ownerChanged || signature !== goalsCategorySignature) {
    const selected = ownerChanged ? goals.category : node('goal-category').value;
    node('goal-category').replaceChildren(new Option('Tutte le categorie', 'all'), ...categories.map(category => new Option(category.name, category.id)));
    node('goal-category').value = categories.some(category => category.id === selected) ? selected : 'all';
    goalsCategorySignature = signature;
  }
  if (ownerChanged) {
    node('goal-budget').value = goals.budget ?? '';
    node('goal-limit').value = goals.limit ?? '';
    node('savings-reduction').value = goals.reduction;
    node('goals-status').textContent = '';
    goalsFormOwner = activeOwnerId;
  }
  const monitoring = readWellness().payload;
  const data = SmokeLogInsights.calculate(events, purchases, now, goals.category, monitoring);
  node('coverage-summary').textContent = `${data.coveredDays} giorni confermati su 28 · monitoraggio dal ${monitoring.startedOn}`;
  node('weekly-summary').textContent = `${data.currentCount} registrazioni negli ultimi 7 giorni completi. ${monitoring.experiment || 'Scegli un piccolo esperimento per osservare le tue abitudini.'}`;
  const selectedLabel = goals.category === 'all' ? 'tutte le categorie' : eventLabel(goals.category);
  node('insight-period').textContent = `${formatDateShort(data.from)} – ${formatDateShort(data.to)} · ${selectedLabel}`;
  node('insight-month-spend').textContent = formatCurrency(data.monthSpend);
  node('insight-daily-spend').textContent = data.dailySpend === null ? '—' : formatCurrency(Math.round(data.dailySpend));
  const delta = (value, current, previous) => !data.comparable ? 'Dati incompleti' : previous === 0 ? (current === 0 ? 'Nessuna variazione' : 'Base precedente zero') : `${value > 0 ? '+' : ''}${value}%`;
  node('insight-change').textContent = delta(data.countChange, data.currentCount, data.previousCount);
  node('insight-change-detail').textContent = `${data.currentCount} registrazioni contro ${data.previousCount} · ultimi 7 giorni completi / 7 precedenti`;
  node('insight-spend-change').textContent = delta(data.spendChange, data.lastWeekSpend, data.previousWeekSpend);
  node('insight-spend-detail').textContent = `${formatCurrency(data.lastWeekSpend)} contro ${formatCurrency(data.previousWeekSpend)} · tutte le spese, stessi periodi`;
  const hours = ['00–06', '06–12', '12–18', '18–24'];
  const weekdays = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
  node('insight-hours').replaceChildren(...data.hourly.map((count, index) => {
    const row = document.createElement('div');
    row.className = 'insight-hour-row';
    const label = document.createElement('span');
    label.textContent = hours[index];
    const meter = document.createElement('progress');
    meter.max = Math.max(1, ...data.hourly);
    meter.value = count;
    meter.setAttribute('aria-label', `${hours[index]}: ${count} registrazioni`);
    const value = document.createElement('strong');
    value.textContent = count;
    row.append(label, meter, value);
    return row;
  }));
  node('insight-peaks').textContent = data.observationCount
    ? `Fasce più attive: ${data.peakTimes.length ? data.peakTimes.map(index => hours[index]).join(', ') : 'nessun andamento dominante'}. Giorni più attivi: ${data.peakDays.length ? data.peakDays.map(index => weekdays[index]).join(', ') : 'nessun andamento dominante'}.`
    : 'Nessuna registrazione nei 28 giorni completi. Le abitudini compariranno qui con il tuo storico.';
  const progress = node('goal-progress');
  progress.replaceChildren();
  const addProgress = (label, value, target, description) => {
    const card = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = label;
    const bar = document.createElement('progress');
    bar.max = Math.max(1, target);
    bar.value = Math.min(bar.max, value);
    bar.setAttribute('aria-label', description);
    const text = document.createElement('small');
    text.textContent = description;
    if (value > target) card.className = 'goal-over';
    card.append(title, bar, text);
    progress.append(card);
  };
  if (goals.budget !== null) {
    const budget = Math.round(goals.budget * 100);
    const remaining = budget - data.monthSpend;
    addProgress('Budget del mese', data.monthSpend, budget,
      `${formatCurrency(data.monthSpend)} di ${formatCurrency(budget)} · ${remaining >= 0 ? 'disponibili' : 'oltre il budget'} ${formatCurrency(Math.abs(remaining))}`);
  }
  if (goals.limit !== null) addProgress(`Registrazioni di oggi · ${selectedLabel}`, data.todayCount, goals.limit,
    `${data.todayCount} di ${goals.limit} · ${data.todayCount <= goals.limit ? 'entro il limite scelto' : 'oltre il limite scelto'}`);
  if (goals.limit === null && goals.budget === null) {
    const text = document.createElement('p');
    text.className = 'microcopy';
    text.textContent = 'Nessun obiettivo impostato. Puoi iniziare dal budget, da un limite giornaliero o da entrambi.';
    progress.append(text);
  }
  renderSavings(data);
}

function renderSavings(data = SmokeLogInsights.calculate(events, purchases, new Date(), readGoals().category, readWellness().payload)) {
  const reduction = Number(document.getElementById('savings-reduction').value);
  const estimate = SmokeLogInsights.savings(data.coveredSpend, reduction, data.coveredDays);
  const canEstimate = data.coveredDays >= SmokeLogInsights.MINIMUM_SAVINGS_COVERAGE_DAYS;
  document.getElementById('savings-percent').textContent = `${reduction}%`;
  document.getElementById('savings-month').textContent = canEstimate ? formatCurrency(estimate.monthly) : '—';
  document.getElementById('savings-year').textContent = canEstimate ? formatCurrency(estimate.yearly) : '—';
  document.getElementById('savings-context').textContent = !canEstimate
    ? `Per mostrare una simulazione servono almeno ${SmokeLogInsights.MINIMUM_SAVINGS_COVERAGE_DAYS} giorni confermati negli ultimi 28. Copertura attuale: ${data.coveredDays}/28.`
    : data.coveredPurchaseCount
      ? `Base di calcolo: ${formatCurrency(data.coveredSpend)} su ${data.coveredDays} giorni confermati degli ultimi 28. Comprende tutte le categorie di spesa.`
      : 'Non risultano acquisti nei giorni confermati degli ultimi 28. Registra gli acquisti per stimare il risparmio.';
}

function setupGoals() {
  document.getElementById('savings-reduction').addEventListener('input', () => renderSavings());
  document.getElementById('savings-reduction').addEventListener('change', () => {
    try {
      saveWellness({ ...readWellness().payload, goals: { ...readGoals(), reduction: Number(document.getElementById('savings-reduction').value) } });
    } catch (error) { showToast('Simulazione aggiornata, ma preferenza non salvata.', 'error'); }
  });
  document.getElementById('goals-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const goals = SmokeLogInsights.validateGoals({
        budget: document.getElementById('goal-budget').value,
        limit: document.getElementById('goal-limit').value,
        category: document.getElementById('goal-category').value,
        reduction: document.getElementById('savings-reduction').value
      });
      saveWellness({ ...readWellness().payload, goals });
      renderInsights();
      document.getElementById('goals-status').textContent = 'Obiettivi salvati su questo dispositivo.';
    } catch (error) { document.getElementById('goals-status').textContent = error.message || 'Impossibile salvare gli obiettivi.'; }
  });
  document.getElementById('reset-goals').addEventListener('click', () => {
    try {
      saveWellness({ ...readWellness().payload, goals: SmokeLogInsights.validateGoals({}) });
      goalsFormOwner = null;
      renderInsights();
      document.getElementById('goals-status').textContent = 'Obiettivi rimossi.';
    } catch (error) { showToast('Impossibile rimuovere gli obiettivi.', 'error'); }
  });
}
