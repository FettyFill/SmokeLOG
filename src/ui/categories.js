function readCategoryPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(CATEGORY_PREFERENCES_KEY) || '{}');
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  } catch (error) {
    console.warn('Preferenze locali delle categorie non leggibili.', error);
    return {};
  }
}

function rememberCategoryPreference(ownerId, category) {
  try {
    const preferences = readCategoryPreferences();
    const ownerPreferences = preferences[ownerId] && typeof preferences[ownerId] === 'object'
      ? preferences[ownerId]
      : {};
    ownerPreferences[category.id] = {
      name: category.name,
      color: category.color,
      position: category.position,
      isActive: Boolean(category.isActive),
      updatedAt: category.updatedAt || new Date().toISOString()
    };
    preferences[ownerId] = ownerPreferences;
    localStorage.setItem(CATEGORY_PREFERENCES_KEY, JSON.stringify(preferences));
  } catch (error) {
    console.warn('Preferenza della categoria non salvata nel fallback locale.', error);
  }
}

function clearCategoryPreferences(ownerId, categoriesToClear) {
  try {
    const preferences = readCategoryPreferences();
    const ownerPreferences = preferences[ownerId];
    if (!ownerPreferences || typeof ownerPreferences !== 'object') return;
    for (const category of categoriesToClear) {
      const preference = ownerPreferences[category.id];
      if (!preference) continue;
      const cloudConfirmedPreference = preference.name === category.name
        && preference.color === category.color
        && preference.position === category.position
        && preference.isActive === Boolean(category.isActive);
      if (cloudConfirmedPreference) delete ownerPreferences[category.id];
    }
    if (Object.keys(ownerPreferences).length === 0) delete preferences[ownerId];
    localStorage.setItem(CATEGORY_PREFERENCES_KEY, JSON.stringify(preferences));
  } catch (error) {
    console.warn('Preferenze locali delle categorie non aggiornate.', error);
  }
}

async function loadCategoriesForOwner(ownerId) {
  const stored = await readAllCategories(ownerId, true);
  const ownerPreferences = readCategoryPreferences()[ownerId];
  const existing = stored.map(category => {
    const preference = ownerPreferences && ownerPreferences[category.id];
    if (!preference || typeof preference.name !== 'string' || !preference.name.trim()
      || preference.name.trim().length > 28 || !Object.hasOwn(CATEGORY_COLORS, preference.color)
      || !Number.isInteger(preference.position) || typeof preference.isActive !== 'boolean'
      || typeof preference.updatedAt !== 'string' || !Number.isFinite(Date.parse(preference.updatedAt))) {
      return category;
    }
    return {
      ...category,
      name: preference.name.trim(),
      color: preference.color,
      position: preference.position,
      isActive: preference.isActive,
      updatedAt: preference.updatedAt,
      pendingSync: true
    };
  });
  const knownIds = new Set(existing.map(category => category.id));
  const defaults = DEFAULT_EVENT_CATEGORIES
    .map((category, index) => ({
      ...category,
      position: index,
      isActive: true,
      updatedAt: new Date(0).toISOString(),
      deletedAt: null
    }))
    .filter(category => !knownIds.has(category.id));
  for (const category of existing.filter(item => item.pendingSync && ownerPreferences && ownerPreferences[item.id])) {
    await persistCategory(category, ownerId);
  }
  for (const category of defaults) await persistCategory(category, ownerId);
  return [...existing, ...defaults].filter(category => !category.deletedAt)
    .sort((first, second) => first.position - second.position);
}

function makeId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  const bytes = window.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function localDateKey(date) {
  // Costruisce la data nel fuso locale, evitando che UTC sposti il giorno esportato.
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
  // Gli intervalli usano mezzanotte locale e un estremo finale esclusivo.
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
  const byCategory = {};
  let total = 0;
  for (const event of source) {
    if (event.deletedAt) continue;
    byCategory[event.type] = (byCategory[event.type] || 0) + 1;
    total += 1;
  }
  return { total, byCategory };
}

function eventLabel(type) {
  const category = categories.find(item => item.id === type);
  return category?.name || (Object.hasOwn(EVENT_LABELS, type) ? EVENT_LABELS[type] : 'Registrazione');
}

function categoryColor(category) {
  return CATEGORY_COLORS[category.color] || CATEGORY_COLORS.slate;
}

function renderCategoryControls(todayCounts, periodCounts) {
  const categoryCount = new Map(categories.map(category => [category.id, todayCounts.byCategory[category.id] || 0]));
  const categoriesWithHistory = categories.filter(category => category.isActive || (periodCounts.byCategory[category.id] || 0) > 0);

  elements.recordButtons.replaceChildren();
  for (const category of categories.filter(item => item.isActive).sort((first, second) => first.position - second.position)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.eventType = category.id;
    button.className = Object.hasOwn(EVENT_LABELS, category.id)
      ? `record-button ${category.id}-button`
      : 'record-button custom-category-button';
    const symbol = document.createElement('span');
    symbol.className = Object.hasOwn(EVENT_LABELS, category.id)
      ? `record-symbol ${category.id === 'half-cigarette' ? 'half-cigarette' : category.id}-symbol`
      : 'record-symbol custom-category-symbol';
    symbol.setAttribute('aria-hidden', 'true');
    if (!Object.hasOwn(EVENT_LABELS, category.id)) {
      symbol.textContent = '●';
      symbol.style.color = categoryColor(category);
      button.style.setProperty('--category-accent', categoryColor(category));
    }
    const copy = document.createElement('span');
    copy.className = 'record-button-copy';
    const name = document.createElement('strong');
    name.textContent = category.name;
    const instruction = document.createElement('small');
    instruction.textContent = 'Aggiungi una';
    copy.append(name, instruction);
    const plus = document.createElement('span');
    plus.className = 'record-plus';
    plus.setAttribute('aria-hidden', 'true');
    plus.textContent = '+';
    button.append(symbol, copy, plus);
    button.addEventListener('click', () => void handleAddEvent(category.id));
    elements.recordButtons.append(button);
  }

  elements.todayCategoryCounts.replaceChildren();
  for (const category of categoriesWithHistory.sort((first, second) => first.position - second.position)) {
    const item = document.createElement('span');
    const dot = document.createElement('span');
    dot.className = `mini-dot${Object.hasOwn(EVENT_LABELS, category.id) ? ` dot-${category.id}` : ''}`;
    if (!Object.hasOwn(EVENT_LABELS, category.id)) dot.style.backgroundColor = categoryColor(category);
    const count = document.createElement('strong');
    count.textContent = formatNumber(categoryCount.get(category.id) || 0);
    item.append(dot, count, document.createTextNode(` ${category.name}`));
    elements.todayCategoryCounts.append(item);
  }

  elements.categoryStatsGrid.replaceChildren();
  for (const category of categoriesWithHistory) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'stat-card category-stat-card';
    button.dataset.eventType = category.id;
    const label = document.createElement('span');
    label.className = 'stat-label';
    label.textContent = category.name;
    const value = document.createElement('strong');
    value.className = 'stat-value';
    value.textContent = formatNumber(periodCounts.byCategory[category.id] || 0);
    value.style.color = categoryColor(category);
    const footnote = document.createElement('span');
    footnote.className = 'stat-footnote';
    footnote.textContent = 'nel periodo · dettagli';
    button.append(label, value, footnote);
    elements.categoryStatsGrid.append(button);
  }
}

function renderCategoryManager() {
  // Background sync must not replace an input while the user is typing.
  if (document.activeElement?.matches('input[type="text"]') && elements.categoryManager.contains(document.activeElement)) return;
  elements.categoryManager.replaceChildren();
  const ordered = [...categories].sort((first, second) => first.position - second.position);
  ordered.forEach((category, index) => {
    const row = document.createElement('div');
    row.className = 'category-manager-row';
    const name = document.createElement('input');
    name.type = 'text';
    name.maxLength = 28;
    name.value = category.name;
    name.setAttribute('aria-label', `Rinomina ${category.name}`);
    name.addEventListener('change', () => {
      const nextName = name.value.trim();
      const duplicate = categories.some(item => item.id !== category.id && item.name.toLocaleLowerCase('it-IT') === nextName.toLocaleLowerCase('it-IT'));
      if (!nextName || duplicate) {
        name.value = category.name;
        showToast(duplicate ? 'Esiste già una categoria con questo nome.' : 'Il nome della categoria non può essere vuoto.', 'error');
        return;
      }
      if (nextName === category.name) return;
      void saveCategoryChanges({ id: category.id, name: nextName });
    });
    const activeLabel = document.createElement('label');
    activeLabel.className = 'category-toggle';
    const active = document.createElement('input');
    active.type = 'checkbox';
    active.checked = Boolean(category.isActive);
    active.setAttribute('aria-label', `${category.isActive ? 'Nascondi' : 'Mostra'} pulsante ${category.name}`);
    active.addEventListener('change', () => {
      void saveCategoryChanges({ id: category.id, isActive: active.checked });
    });
    activeLabel.append(active, document.createTextNode('Mostra pulsante'));
    const order = document.createElement('div');
    order.className = 'category-order-controls';
    for (const [direction, text, label] of [
      ['up', '↑', `Sposta ${category.name} in alto`],
      ['down', '↓', `Sposta ${category.name} in basso`]
    ]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = text;
      button.disabled = direction === 'up' ? index === 0 : index === ordered.length - 1;
      button.setAttribute('aria-label', label);
      button.addEventListener('click', () => void moveCategory(category.id, direction));
      order.append(button);
    }
    row.append(name, activeLabel, order);
    elements.categoryManager.append(row);
  });
}

async function saveCategoryChanges(updatedCategory) {
  try {
    const current = categories.find(category => category.id === updatedCategory.id);
    if (!current) return;
    const categoryToSave = { ...current, ...updatedCategory, pendingSync: true,
      updatedAt: new Date(Math.max(Date.now(), (Date.parse(current.updatedAt) || 0) + 1)).toISOString() };
    const nextCategories = categories.map(category => category.id === categoryToSave.id ? categoryToSave : category);
    await persistCategory(categoryToSave);
    rememberCategoryPreference(activeOwnerId, categoryToSave);
    markLocalMutation();
    categories = nextCategories.sort((first, second) => first.position - second.position);
    render();
    setCategorySettingsStatus('Modifiche salvate su questo dispositivo.');
    requestCloudSync();
  } catch (error) {
    console.error(error);
    renderCategoryManager();
    setCategorySettingsStatus('Modifica non salvata. Riprova.', true);
    showToast('Modifica della categoria non salvata sul dispositivo.', 'error');
  }
}

async function moveCategory(categoryId, direction) {
  const ordered = categories.map(category => ({ ...category })).sort((first, second) => first.position - second.position);
  const index = ordered.findIndex(category => category.id === categoryId);
  const nextIndex = index + (direction === 'up' ? -1 : 1);
  if (index < 0 || nextIndex < 0 || nextIndex >= ordered.length) return;
  const timestamp = new Date().toISOString();
  [ordered[index].position, ordered[nextIndex].position] = [ordered[nextIndex].position, ordered[index].position];
  const changed = [ordered[index], ordered[nextIndex]].map(category => ({ ...category, updatedAt: timestamp, pendingSync: true }));
  try {
    for (const category of changed) {
      await persistCategory(category);
      rememberCategoryPreference(activeOwnerId, category);
    }
    markLocalMutation();
    const changedById = new Map(changed.map(category => [category.id, category]));
    categories = ordered.map(category => changedById.get(category.id) || category);
    render();
    setCategorySettingsStatus('Ordine salvato su questo dispositivo.');
    requestCloudSync();
  } catch (error) {
    console.error(error);
    renderCategoryManager();
    setCategorySettingsStatus('Ordine non salvato. Riprova.', true);
    showToast('Ordine delle categorie non salvato sul dispositivo.', 'error');
  }
}

async function addCategory(name) {
  const normalizedName = name.trim();
  if (!normalizedName) return false;
  if (categories.some(category => category.name.toLocaleLowerCase('it-IT') === normalizedName.toLocaleLowerCase('it-IT'))) {
    showToast('Esiste già una categoria con questo nome.', 'error');
    return false;
  }
  const colors = Object.keys(CATEGORY_COLORS);
  const category = {
    id: makeId(),
    name: normalizedName,
    color: colors[categories.length % colors.length],
    position: categories.length ? Math.max(...categories.map(item => item.position)) + 1 : 0,
    isActive: true,
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    pendingSync: true
  };
  try {
    await persistCategory(category);
    rememberCategoryPreference(activeOwnerId, category);
    markLocalMutation();
    categories.push(category);
    render();
    setCategorySettingsStatus('Categoria salvata su questo dispositivo.');
    requestCloudSync();
    showToast(`Categoria “${normalizedName}” aggiunta.`);
    return true;
  } catch (error) {
    console.error(error);
    setCategorySettingsStatus('Categoria non salvata. Riprova.', true);
    showToast('Categoria non salvata sul dispositivo.', 'error');
    return false;
  }
}

function setCategorySettingsStatus(message, isError = false) {
  if (!elements.categorySettingsStatus) return;
  elements.categorySettingsStatus.textContent = message;
  elements.categorySettingsStatus.classList.toggle('is-error', isError);
}

function setupSettingsSectionPreferences() {
  let preferences = {};
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_SECTIONS_KEY) || '{}');
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) preferences = saved;
  } catch (error) {
    console.error(error);
    showToast('Non è stato possibile recuperare lo stato delle sezioni delle impostazioni.', 'error');
  }

  const sections = [...document.querySelectorAll('details.settings-section[data-settings-key]')];
  for (const section of sections) {
    const key = section.dataset.settingsKey;
    if (typeof preferences[key] === 'boolean') section.open = preferences[key];
    section.addEventListener('toggle', () => {
      preferences[key] = section.open;
      try {
        localStorage.setItem(SETTINGS_SECTIONS_KEY, JSON.stringify(preferences));
      } catch (error) {
        console.error(error);
        showToast('Lo stato delle impostazioni non è stato salvato su questo dispositivo.', 'error');
      }
    });
  }
}

