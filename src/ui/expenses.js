function renderExpenseTrend(periodPurchases, now) {
  const buckets = makeBuckets(activeRange, now);
  for (const bucket of buckets) {
    bucket.amountCents = periodPurchases
      .filter(purchase => withinRange(purchase, bucket.start, bucket.end))
      .reduce((sum, purchase) => sum + purchase.amountCents, 0);
  }

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 360 200');
  svg.setAttribute('class', 'analytics-chart-svg expense-trend-svg');
  svg.dataset.chartRange = activeRange;
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Spesa per periodo: ${buckets.map(bucket => `${bucket.label} ${formatCurrency(bucket.amountCents)}`).join(', ')}`);

  const plot = { left: 45, right: 354, top: 16, bottom: 145 };
  const maxEuros = Math.max(0, ...buckets.map(bucket => bucket.amountCents / 100));
  const axis = calculateAxis(maxEuros || 4);
  const plotHeight = plot.bottom - plot.top;
  const plotWidth = plot.right - plot.left;
  const currencyFormatter = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 });
  for (const tick of axis.ticks) {
    const y = plot.bottom - (tick / axis.max) * plotHeight;
    svg.append(createChartSvgElement(svg, 'line', {
      x1: plot.left, x2: plot.right, y1: y, y2: y, class: 'analytics-gridline'
    }));
    const tickLabel = createChartSvgElement(svg, 'text', {
      x: plot.left - 7, y: y + 3, class: 'analytics-axis-label analytics-y-label'
    });
    tickLabel.textContent = `€${currencyFormatter.format(tick)}`;
    svg.append(tickLabel);
  }
  svg.append(createChartSvgElement(svg, 'line', {
    x1: plot.left, x2: plot.right, y1: plot.bottom, y2: plot.bottom, class: 'analytics-baseline'
  }));

  const points = buckets.map((bucket, index) => {
    const x = buckets.length === 1
      ? (plot.left + plot.right) / 2
      : plot.left + ((plot.right - plot.left) * index) / (buckets.length - 1);
    const y = plot.bottom - ((bucket.amountCents / 100) / axis.max) * plotHeight;
    return { x, y, bucket };
  });
  const area = createChartSvgElement(svg, 'polygon', {
    points: `${points[0].x},${plot.bottom} ${points.map(point => `${point.x},${point.y}`).join(' ')} ${points[points.length - 1].x},${plot.bottom}`,
    class: 'expense-trend-area'
  });
  svg.append(area);
  svg.append(createChartSvgElement(svg, 'polyline', {
    points: points.map(point => `${point.x},${point.y}`).join(' '),
    class: 'expense-trend-line'
  }));

  const maxPointIndex = points.reduce((bestIndex, candidate, candidateIndex) =>
    candidate.bucket.amountCents > points[bestIndex].bucket.amountCents ? candidateIndex : bestIndex, 0);
  points.forEach((point, index) => {
    const marker = createChartSvgElement(svg, 'circle', {
      cx: point.x, cy: point.y, r: 3.5, class: 'expense-trend-point'
    });
    const title = createChartSvgElement(svg, 'title');
    title.textContent = `${point.bucket.label}: ${formatCurrency(point.bucket.amountCents)}`;
    marker.append(title);
    svg.append(marker);

    if (point.bucket.amountCents > 0
      && (buckets.length <= 7 || index === 0 || index === buckets.length - 1 || index === maxPointIndex)) {
      const valueLabel = createChartSvgElement(svg, 'text', {
        x: point.x,
        y: Math.max(plot.top - 5, point.y - 9),
        class: 'expense-trend-value'
      });
      valueLabel.textContent = formatCurrency(point.bucket.amountCents);
      svg.append(valueLabel);
    }

    const [primaryLabel, secondaryLabel] = chartBucketLabels(activeRange, point.bucket);
    const label = createChartSvgElement(svg, 'text', {
      x: point.x, y: 166, class: 'analytics-axis-label analytics-x-label'
    });
    label.textContent = primaryLabel;
    svg.append(label);
    if (secondaryLabel) {
      const secondary = createChartSvgElement(svg, 'text', {
        x: point.x, y: 178, class: 'analytics-axis-label analytics-x-label analytics-x-sub-label'
      });
      secondary.textContent = secondaryLabel;
      svg.append(secondary);
    }
  });

  elements.expenseTrendChart.replaceChildren(svg);
  const periodUnit = { day: 'fascia', week: 'giorno', month: 'settimana', year: 'mese' }[activeRange];
  const averageCents = periodPurchases.reduce((sum, purchase) => sum + purchase.amountCents, 0) / buckets.length;
  elements.expenseTrendSubtitle.textContent = `Totale per periodo · media ${formatCurrency(averageCents)} per ${periodUnit}`;
  if (periodPurchases.length === 0) {
    const note = document.createElement('p');
    note.className = 'chart-empty-note';
    note.textContent = 'Nessuna spesa in questo periodo. Il grafico si aggiornerà quando registrerai un acquisto.';
    elements.expenseTrendChart.append(note);
  }
}

function renderExpenseSummary(periodPurchases, now = new Date()) {
  const totals = Object.fromEntries(Object.keys(PURCHASE_LABELS).map(type => [type, 0]));
  for (const purchase of periodPurchases) {
    if (Object.hasOwn(totals, purchase.type)) totals[purchase.type] += purchase.amountCents;
  }
  const totalCents = periodPurchases.reduce((total, purchase) => total + purchase.amountCents, 0);
  elements.periodExpenseTotal.textContent = formatCurrency(totalCents);
  renderExpenseTrend(periodPurchases, now);
  elements.expenseCategoryGrid.replaceChildren();
  for (const [type, label] of Object.entries(PURCHASE_LABELS)) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `expense-category-card expense-${type}`;
    card.dataset.purchaseType = type;
    card.setAttribute('aria-label', `Mostra acquisti: ${label}, totale ${formatCurrency(totals[type])}`);
    const name = document.createElement('span');
    name.textContent = label;
    const amount = document.createElement('strong');
    amount.textContent = formatCurrency(totals[type]);
    card.append(name, amount);
    elements.expenseCategoryGrid.append(card);
  }

  elements.expenseBars.replaceChildren();
  const maxCents = Math.max(0, ...Object.values(totals));
  for (const [type, label] of Object.entries(PURCHASE_LABELS)) {
    const row = document.createElement('div');
    row.className = `expense-bar-row expense-${type}`;
    const name = document.createElement('span');
    name.className = 'expense-bar-label';
    name.textContent = label;
    const track = document.createElement('div');
    track.className = 'expense-bar-track';
    track.setAttribute('aria-label', `${label}: ${formatCurrency(totals[type])}`);
    const fill = document.createElement('div');
    fill.className = 'expense-bar-fill';
    fill.style.width = `${maxCents === 0 || totals[type] === 0 ? 0 : Math.max(4, (totals[type] / maxCents) * 100)}%`;
    track.append(fill);
    const amount = document.createElement('strong');
    amount.className = 'expense-bar-value';
    amount.textContent = formatCurrency(totals[type]);
    row.append(name, track, amount);
    elements.expenseBars.append(row);
  }
  if (periodPurchases.length === 0) {
    const note = document.createElement('p');
    note.className = 'chart-empty-note';
    note.textContent = 'Nessuna spesa in questo periodo. Registra un acquisto per vedere il riepilogo.';
    elements.expenseBars.append(note);
  }
}

