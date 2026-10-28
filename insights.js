'use strict';

// Pure calculations shared by the UI and the regression tests. Calendar days
// are constructed locally, so daylight-saving changes do not shorten a period.
(function (root) {
  function day(date, offset = 0) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset);
  }
  function between(record, start, end) {
    const time = Date.parse(record.timestamp);
    return !record.deletedAt && time >= start.getTime() && time < end.getTime();
  }
  function change(current, previous) {
    return previous === 0 ? null : Math.round((current - previous) / previous * 100);
  }
  function calculate(events, purchases, now = new Date(), category = 'all') {
    const today = day(now);
    const tomorrow = day(now, 1);
    const week = day(now, -7);
    const previousWeek = day(now, -14);
    const monthWindow = day(now, -28);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const visible = events.filter(event => !event.deletedAt && (category === 'all' || event.type === category));
    const recent = visible.filter(event => between(event, week, today));
    const previous = visible.filter(event => between(event, previousWeek, week));
    const spending = purchases.filter(purchase => !purchase.deletedAt && Number.isSafeInteger(purchase.amountCents) && purchase.amountCents > 0);
    const sum = list => list.reduce((total, item) => total + item.amountCents, 0);
    const lastWeekSpend = sum(spending.filter(item => between(item, week, today)));
    const previousWeekSpend = sum(spending.filter(item => between(item, previousWeek, week)));
    const last28Purchases = spending.filter(item => between(item, monthWindow, today));
    const hourly = Array(4).fill(0);
    const weekdays = Array(7).fill(0);
    const observation = visible.filter(event => between(event, monthWindow, today));
    for (const event of observation) {
      const date = new Date(event.timestamp);
      hourly[Math.floor(date.getHours() / 6)]++;
      weekdays[(date.getDay() + 6) % 7]++;
    }
    const peaks = values => {
      const maximum = Math.max(...values);
      return maximum ? values.flatMap((value, index) => value === maximum ? [index] : []) : [];
    };
    return {
      todayCount: visible.filter(event => between(event, today, tomorrow) && Date.parse(event.timestamp) <= now.getTime()).length,
      currentCount: recent.length, previousCount: previous.length,
      countChange: change(recent.length, previous.length),
      lastWeekSpend, previousWeekSpend, spendChange: change(lastWeekSpend, previousWeekSpend),
      monthSpend: sum(spending.filter(item => between(item, monthStart, tomorrow) && Date.parse(item.timestamp) <= now.getTime())),
      last28Spend: sum(last28Purchases), purchaseCount: last28Purchases.length,
      dailySpend: sum(last28Purchases) / 28,
      hourly, peakTimes: peaks(hourly), peakDays: peaks(weekdays),
      observationCount: observation.length,
      from: monthWindow, to: day(now, -1), weekFrom: week, weekTo: day(now, -1)
    };
  }
  function savings(spend28, reduction) {
    const fraction = Math.min(100, Math.max(0, Number(reduction) || 0)) / 100;
    return { monthly: Math.round(spend28 / 28 * 30 * fraction), yearly: Math.round(spend28 / 28 * 365 * fraction) };
  }
  function validateGoals(input) {
    const budget = input.budget === '' || input.budget == null ? null : Number(input.budget);
    const limit = input.limit === '' || input.limit == null ? null : Number(input.limit);
    const reduction = Number(input.reduction ?? 20);
    if (budget !== null && (!Number.isFinite(budget) || budget <= 0 || budget > 100000)) throw new Error('Inserisci un budget maggiore di zero e fino a 100.000 €.');
    if (limit !== null && (!Number.isInteger(limit) || limit < 0 || limit > 10000)) throw new Error('Il limite giornaliero deve essere un numero intero tra 0 e 10.000.');
    if (!Number.isInteger(reduction) || reduction < 0 || reduction > 100) throw new Error('La riduzione deve essere compresa tra 0 e 100%.');
    return { budget: budget === null ? null : Math.round(budget * 100) / 100, limit, reduction,
      category: typeof input.category === 'string' ? input.category : 'all' };
  }
  const api = { calculate, savings, validateGoals };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SmokeLogInsights = api;
})(globalThis);
