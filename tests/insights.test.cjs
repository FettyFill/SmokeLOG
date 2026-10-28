const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calculate, savings, validateGoals } = require('../insights.js');

test('equal complete calendar windows exclude today and deleted records', () => {
  const now = new Date(2026, 9, 28, 12);
  const record = (day, type = 'cigarette') => ({ timestamp: new Date(2026, 9, day, 10).toISOString(), type });
  const data = calculate([record(27), record(21), record(20), record(28), { ...record(25), deletedAt: '2026-10-26' }], [], now);
  assert.equal(data.currentCount, 2);
  assert.equal(data.previousCount, 1);
  assert.equal(data.countChange, 100);
  assert.equal(data.todayCount, 1);
});

test('category selection changes counts but keeps the actual spending total', () => {
  const data = calculate([{ timestamp: '2026-10-27T12:00:00', type: 'joint' }], [{ timestamp: '2026-10-27T12:00:00', amountCents: 2800 }], new Date(2026, 9, 28), 'cigarette');
  assert.equal(data.currentCount, 0);
  assert.equal(data.last28Spend, 2800);
  assert.equal(data.dailySpend, 100);
  assert.deepEqual(savings(data.last28Spend, 20), { monthly: 600, yearly: 7300 });
});

test('empty periods and ties have honest outputs', () => {
  const empty = calculate([], [], new Date(2026, 9, 28));
  assert.equal(empty.countChange, null);
  assert.deepEqual(empty.peakTimes, []);
  const data = calculate([{ timestamp: '2026-10-26T01:00:00' }, { timestamp: '2026-10-27T13:00:00' }], [], new Date(2026, 9, 28));
  assert.deepEqual(data.peakTimes, [0, 2]);
});

test('zero goals are explicit and invalid goals are rejected', () => {
  assert.equal(validateGoals({ limit: '0' }).limit, 0);
  assert.equal(validateGoals({ budget: '' }).budget, null);
  assert.throws(() => validateGoals({ limit: '1.5' }));
  assert.throws(() => validateGoals({ budget: '-2' }));
  assert.throws(() => validateGoals({ reduction: 101 }));
});
