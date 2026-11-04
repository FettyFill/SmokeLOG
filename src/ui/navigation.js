function render() {
  const now = new Date();
  elements.currentDate.textContent = capitalizeFirst(now.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
  const todayEvents = filterForRange('day', now);
  const todayCounts = countTypes(todayEvents);
  elements.todayTotal.textContent = formatNumber(todayCounts.total);
  elements.todayTotalLabel.textContent = todayCounts.total === 1 ? 'registrazione' : 'registrazioni';
  const todayPurchases = purchases.filter(purchase => withinRange(purchase, startOfRange('day', now), endOfRange('day', now)));
  const todaySpendCents = todayPurchases.reduce((total, purchase) => total + purchase.amountCents, 0);
  elements.todayExpenseTotal.textContent = formatCurrency(todaySpendCents);
  elements.todayExpenseCount.textContent = todayPurchases.length === 0
    ? 'Nessun acquisto registrato'
    : `${formatNumber(todayPurchases.length)} ${todayPurchases.length === 1 ? 'acquisto' : 'acquisti'} registrati`;

  const labels = { day: 'Totale di oggi', week: 'Totale ultimi 7 giorni', month: 'Totale del mese', year: 'Totale dell’anno' };
  const periodEvents = filterForRange(activeRange, now);
  const periodPurchases = purchases.filter(purchase => withinRange(purchase, startOfRange(activeRange, now), endOfRange(activeRange, now)));
  const counts = countTypes(periodEvents);
  elements.periodLabel.textContent = labels[activeRange];
  elements.periodTotal.textContent = formatNumber(counts.total);
  renderCategoryControls(todayCounts, counts);
  renderCategoryManager();
  renderExpenseSummary(periodPurchases, now);
  renderChart(activeRange, periodEvents, now);
  renderWeeklyInsights(now);
  renderInsights(now);
  renderHistory();
  renderWellness();
  if (activeCategoryDetails && elements.categoryDetailsDialog.open) renderCategoryDetails();
}

function loadStatsPreferences() {
  try {
    const savedPreferences = JSON.parse(localStorage.getItem(STATS_PREFERENCES_KEY) || '{}');
    if (['day', 'week', 'month', 'year'].includes(savedPreferences.range)) activeRange = savedPreferences.range;
    if (['expenses', 'consumption', 'insights'].includes(savedPreferences.view)) {
      activeStatsView = savedPreferences.view;
    }
  } catch (error) {
    console.error(error);
    showToast('Non è stato possibile recuperare le preferenze delle statistiche.', 'error');
  }
}

function saveStatsPreferences() {
  try {
    localStorage.setItem(STATS_PREFERENCES_KEY, JSON.stringify({
      range: activeRange,
      view: activeStatsView
    }));
  } catch (error) {
    console.error(error);
    showToast('Preferenze non salvate. Controlla lo spazio disponibile nel browser.', 'error');
  }
}

function updateRangeButtons() {
  document.querySelectorAll('[data-range]').forEach(button => {
    const selected = button.dataset.range === activeRange;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}

function setStatsView(view, persist = true) {
  if (!['expenses', 'consumption', 'insights'].includes(view)) return;
  activeStatsView = view;
  elements.expenseView.hidden = view !== 'expenses';
  elements.consumptionView.hidden = view !== 'consumption';
  document.getElementById('insights-view').hidden = view !== 'insights';
  document.getElementById('stats-range-switch').hidden = view === 'insights';
  document.querySelectorAll('[data-stats-view]').forEach(button => {
    const selected = button.dataset.statsView === view;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  if (persist) saveStatsPreferences();
}

function setAppPage(page) {
  const pages = [...document.querySelectorAll('[data-app-page]')];
  if (!pages.some(item => item.dataset.appPage === page)) return;
  for (const item of pages) {
    item.hidden = item.dataset.appPage !== page;
  }
  document.querySelectorAll('[data-page-target]').forEach(button => {
    const selected = button.dataset.pageTarget === page;
    button.classList.toggle('is-active', selected);
    if (selected) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
}

