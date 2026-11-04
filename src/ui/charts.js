function formatNumber(number) {
  return new Intl.NumberFormat('it-IT').format(number);
}

function formatCurrency(amountCents) {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(amountCents / 100);
}

function capitalizeFirst(value) {
  return value ? value.charAt(0).toLocaleUpperCase('it-IT') + value.slice(1) : value;
}

function formatDateTime(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return 'Data non valida';
  return `${capitalizeFirst(date.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' }))} · ${date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}`;
}

function toDateTimeLocalValue(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return '';
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
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
  // Le barre del grafico cambiano granularità in base al periodo selezionato.
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

function calculateAxis(maxValue, divisions = 4) {
  const safeMax = Math.max(0, maxValue);
  const roughStep = safeMax > 0 ? safeMax / divisions : 1;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalizedStep = roughStep / magnitude;
  const stepSize = normalizedStep <= 1 ? 1
    : normalizedStep <= 2 ? 2
      : normalizedStep <= 5 ? 5
        : 10;
  const step = stepSize * magnitude;
  const max = Math.max(step, Math.ceil(safeMax / step) * step);
  const ticks = [];
  for (let value = 0; value <= max + step * 0.001; value += step) {
    ticks.push(Number(value.toPrecision(12)));
  }
  return { max, ticks };
}

function calculateCountAxis(maxValue) {
  const step = Math.max(1, Math.ceil(maxValue / 4));
  const max = Math.max(4, Math.ceil(maxValue / step) * step);
  return {
    max,
    ticks: Array.from({ length: max / step + 1 }, (_, index) => index * step)
  };
}

function formatAverage(value) {
  return new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 }).format(value);
}

function createChartSvgElement(svg, tag, attributes = {}) {
  const element = document.createElementNS(svg.namespaceURI, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  return element;
}

function chartBucketLabels(range, bucket) {
  if (range === 'week') {
    const date = new Date(bucket.start);
    return [
      capitalizeFirst(date.toLocaleDateString('it-IT', { weekday: 'short' }).replace('.', '')),
      String(date.getDate())
    ];
  }
  return [bucket.shortLabel, ''];
}

function renderChart(range, periodEvents, now = new Date()) {
  const buckets = makeBuckets(range, now);
  for (const bucket of buckets) {
    bucket.count = periodEvents.filter(event => withinRange(event, bucket.start, bucket.end)).length;
  }
  const axis = calculateCountAxis(Math.max(0, ...buckets.map(bucket => bucket.count)));
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 360 200');
  svg.setAttribute('class', 'analytics-chart-svg consumption-chart-svg');
  svg.dataset.chartRange = range;
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Registrazioni per periodo: ${buckets.map(bucket => `${bucket.label}: ${formatNumber(bucket.count)}`).join(', ')}`);
  const defs = createChartSvgElement(svg, 'defs');
  const gradient = createChartSvgElement(svg, 'linearGradient', {
    id: 'consumption-bar-gradient', x1: '0%', y1: '100%', x2: '0%', y2: '0%'
  });
  gradient.append(
    createChartSvgElement(svg, 'stop', { offset: '0%', 'stop-color': '#408e75' }),
    createChartSvgElement(svg, 'stop', { offset: '100%', 'stop-color': '#66e0b3' })
  );
  defs.append(gradient);
  svg.append(defs);
  const plot = { left: 38, right: 354, top: 16, bottom: 145 };
  const plotHeight = plot.bottom - plot.top;
  const plotWidth = plot.right - plot.left;
  for (const tick of axis.ticks) {
    const y = plot.bottom - (tick / axis.max) * plotHeight;
    svg.append(createChartSvgElement(svg, 'line', {
      x1: plot.left, x2: plot.right, y1: y, y2: y, class: 'analytics-gridline'
    }));
    const tickLabel = createChartSvgElement(svg, 'text', {
      x: plot.left - 7, y: y + 3, class: 'analytics-axis-label analytics-y-label'
    });
    tickLabel.textContent = formatNumber(tick);
    svg.append(tickLabel);
  }
  svg.append(createChartSvgElement(svg, 'line', {
    x1: plot.left, x2: plot.right, y1: plot.bottom, y2: plot.bottom, class: 'analytics-baseline'
  }));

  const slotWidth = plotWidth / buckets.length;
  const barWidth = Math.min(25, Math.max(8, slotWidth * 0.58));
  buckets.forEach((bucket, index) => {
    const center = plot.left + slotWidth * (index + 0.5);
    const barHeight = (bucket.count / axis.max) * plotHeight;
    const bar = createChartSvgElement(svg, 'rect', {
      x: center - barWidth / 2,
      y: plot.bottom - barHeight,
      width: barWidth,
      height: barHeight,
      rx: Math.min(5, barWidth / 3),
      class: 'analytics-bar'
    });
    const title = createChartSvgElement(svg, 'title');
    title.textContent = `${bucket.label}: ${formatNumber(bucket.count)} ${bucket.count === 1 ? 'registrazione' : 'registrazioni'}`;
    bar.append(title);
    svg.append(bar);

    if (bucket.count > 0) {
      const valueLabel = createChartSvgElement(svg, 'text', {
        x: center,
        y: Math.max(plot.top - 4, plot.bottom - barHeight - 6),
        class: 'analytics-value-label'
      });
      valueLabel.textContent = formatNumber(bucket.count);
      svg.append(valueLabel);
    }

    const [primaryLabel, secondaryLabel] = chartBucketLabels(range, bucket);
    const label = createChartSvgElement(svg, 'text', {
      x: center,
      y: 166,
      class: 'analytics-axis-label analytics-x-label'
    });
    label.textContent = primaryLabel;
    svg.append(label);
    if (secondaryLabel) {
      const secondary = createChartSvgElement(svg, 'text', {
        x: center,
        y: 178,
        class: 'analytics-axis-label analytics-x-label analytics-x-sub-label'
      });
      secondary.textContent = secondaryLabel;
      svg.append(secondary);
    }
  });

  elements.chartBars.dataset.chartRange = range;
  elements.chartBars.replaceChildren();
  elements.chartBars.append(svg);

  const titles = {
    day: ['Distribuzione di oggi', 'Per fascia oraria', 'fascia'],
    week: ['Ultimi sette giorni', 'Registrazioni per giorno', 'giorno'],
    month: ['Andamento del mese', 'Registrazioni per settimana', 'settimana'],
    year: ['Andamento dell’anno', 'Registrazioni per mese', 'mese']
  };
  elements.chartTitle.textContent = titles[range][0];
  const average = periodEvents.length / buckets.length;
  elements.chartSubtitle.textContent = `${titles[range][1]} · media ${formatAverage(average)} per ${titles[range][2]}`;
  elements.chartTotalPill.textContent = `${formatNumber(periodEvents.length)} totali`;
  if (periodEvents.length === 0) {
    const note = document.createElement('p');
    note.className = 'chart-empty-note';
    note.textContent = 'Nessuna registrazione in questo periodo. Il grafico si aggiornerà quando aggiungerai un evento.';
    elements.chartBars.append(note);
  }
}

