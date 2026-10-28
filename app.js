'use strict';

const DB_NAME = 'smokelog-local-db';
const DB_VERSION = 6;
const SYNC_STORE_NAME = 'sync-state';
const STORE_NAME = 'events';
const PURCHASE_STORE_NAME = 'purchases';
const CATEGORY_STORE_NAME = 'categories';
const PROFILE_DRAFT_STORE_NAME = 'profile-drafts';
const AVATAR_BUCKET = 'smokelog-avatars';
const GUEST_OWNER_ID = 'guest';
const HISTORY_PAGE_SIZE = 20;
const CLOUD_BATCH_SIZE = 500;
const MAX_BACKUP_FILE_SIZE = 10 * 1024 * 1024;
const CLOUD_SESSION_KEY = 'smokelog-supabase-session';
const LAST_SYNC_USER_KEY = 'smokelog-last-sync-user';
const CATEGORY_PREFERENCES_KEY = 'smokelog-category-preferences';
const STATS_PREFERENCES_KEY = 'smokelog-stats-preferences';
const SETTINGS_SECTIONS_KEY = 'smokelog-settings-sections';
const EVENT_LABELS = {
  cigarette: 'Sigaretta',
  joint: 'Barnei',
  'half-cigarette': 'Mezza Siga',
  puzzetta: 'Puzzetta',
  puff: 'Cartuccia Puff'
};
const DEFAULT_EVENT_CATEGORIES = [
  { id: 'cigarette', name: 'Sigaretta', color: 'blue' },
  { id: 'joint', name: 'Barnei', color: 'mint' },
  { id: 'half-cigarette', name: 'Mezza Siga', color: 'violet' },
  { id: 'puzzetta', name: 'Puzzetta', color: 'amber' },
  { id: 'puff', name: 'Cartuccia Puff', color: 'cyan' }
];
const CATEGORY_COLORS = {
  blue: '#88b9ff',
  mint: '#66e0b3',
  violet: '#c49be6',
  amber: '#e8b878',
  cyan: '#8bd5e8',
  coral: '#ff9f80',
  pink: '#eb9acb',
  slate: '#a4b4bf'
};
const PURCHASE_LABELS = {
  'cigarette-pack': 'Pacchetto di Siga',
  weed: 'Fumo/Weed',
  'terea-pack': 'Pacchetto Terea',
  'puff-cartridge': 'Cartuccia Puff',
  'tobacco-pack': 'Pacchetto di Tabacco'
};

let database;
let databaseOpening;
let events = [];
let purchases = [];
let categories = [];
let activeOwnerId = GUEST_OWNER_ID;
let activeRange = 'day';
let activeStatsView = 'expenses';
let activeCategoryDetails = null;
let activeTimestampEdit = null;
let historyKindFilter = 'all';
let historyRangeFilter = 'all';
let historyVisibleCount = HISTORY_PAGE_SIZE;
let toastTimer;
let cloudSession = null;
let isAuthenticated = false;
let isAppReady = false;
// Incrementato dopo ogni modifica locale. La sincronizzazione usa questo
// contatore per non sostituire lo storico con una fotografia ormai vecchia.
let localMutationVersion = 0;
let cloudSyncNeedsAnotherPass = false;
let isPasswordRecovery = false;
let authMode = 'signin';
let awaitingEmailConfirmation = false;
let authRequestPending = false;
let profileSavePending = false;
let authRestorePromise = null;
let cloudSyncPromise = null;
let cloudSyncTimer = null;
let signupAvatarDraft = null;
let profileAvatarDraft = null;
let removeProfileAvatarOnSave = false;
let profileAvatarPreviewUrl = null;
let signupAvatarPreviewUrl = null;
let resolvedAvatarCache = null;
let avatarResolutionKey = '';
let avatarResolutionPromise = null;

const supabaseConfig = window.SMOKELOG_SUPABASE_CONFIG || {};
// Abilita l'accesso cloud solo se URL e chiave pubblica hanno un formato utilizzabile.
const cloudConfigured = typeof supabaseConfig.url === 'string'
  && /^https:\/\/.+\.supabase\.co\/?$/.test(supabaseConfig.url)
  && typeof supabaseConfig.anonKey === 'string'
  && supabaseConfig.anonKey.length > 20
  && !supabaseConfig.anonKey.includes('YOUR_');

const elements = {
  currentDate: document.getElementById('current-date'),
  todayTotal: document.getElementById('today-total'),
  todayTotalLabel: document.getElementById('today-total-label'),
  todayCategoryCounts: document.getElementById('today-category-counts'),
  recordButtons: document.getElementById('record-buttons'),
  categoryStatsGrid: document.getElementById('category-stats-grid'),
  periodLabel: document.getElementById('period-label'),
  periodTotal: document.getElementById('period-total'),
  todayExpenseTotal: document.getElementById('today-expense-total'),
  todayExpenseCount: document.getElementById('today-expense-count'),
  periodExpenseTotal: document.getElementById('period-expense-total'),
  expenseTrendChart: document.getElementById('expense-trend-chart'),
  expenseCategoryGrid: document.getElementById('expense-category-grid'),
  expenseBars: document.getElementById('expense-bars'),
  expenseView: document.getElementById('expense-view'),
  consumptionView: document.getElementById('consumption-view'),
  chartTitle: document.getElementById('chart-title'),
  chartSubtitle: document.getElementById('chart-subtitle'),
  chartTotalPill: document.getElementById('chart-total-pill'),
  chartBars: document.getElementById('chart-bars'),
  expenseTrendSubtitle: document.getElementById('expense-trend-subtitle'),
  weeklyInsights: document.getElementById('weekly-insights'),
  weeklyTotal: document.getElementById('weekly-total'),
  weeklyChange: document.getElementById('weekly-change'),
  weeklySpend: document.getElementById('weekly-spend'),
  weeklyDailySpend: document.getElementById('weekly-daily-spend'),
  weeklyPeakTime: document.getElementById('weekly-peak-time'),
  weeklyPeakDay: document.getElementById('weekly-peak-day'),
  historyList: document.getElementById('history-list'),
  historyCount: document.getElementById('history-count'),
  historyFootnote: document.getElementById('history-footnote'),
  historyKindFilter: document.getElementById('history-kind-filter'),
  historyRangeFilter: document.getElementById('history-range-filter'),
  historyLoadMore: document.getElementById('history-load-more'),
  timestampDialog: document.getElementById('timestamp-dialog'),
  timestampDialogEyebrow: document.getElementById('timestamp-dialog-eyebrow'),
  timestampDialogTitle: document.getElementById('timestamp-dialog-title'),
  timestampForm: document.getElementById('timestamp-form'),
  timestampDate: document.getElementById('timestamp-date'),
  timestampTime: document.getElementById('timestamp-time'),
  timestampFormError: document.getElementById('timestamp-form-error'),
  timestampCancel: document.getElementById('timestamp-cancel'),
  timestampSave: document.getElementById('timestamp-save'),
  categoryDetailsDialog: document.getElementById('category-details-dialog'),
  categoryDetailsTitle: document.getElementById('category-details-title'),
  categoryDetailsDescription: document.getElementById('category-details-description'),
  categoryDetailsList: document.getElementById('category-details-list'),
  closeCategoryDetails: document.getElementById('close-category-details'),
  purchaseDialog: document.getElementById('purchase-dialog'),
  purchaseForm: document.getElementById('purchase-form'),
  purchaseType: document.getElementById('purchase-type'),
  purchaseAmount: document.getElementById('purchase-amount'),
  purchaseFormError: document.getElementById('purchase-form-error'),
  purchaseCancel: document.getElementById('purchase-cancel'),
  purchaseSave: document.getElementById('purchase-save'),
  toast: document.getElementById('toast'),
  toastIcon: document.getElementById('toast-icon'),
  toastMessage: document.getElementById('toast-message'),
  actionDialog: document.getElementById('action-dialog'),
  actionDialogIcon: document.getElementById('action-dialog-icon'),
  actionDialogEyebrow: document.getElementById('action-dialog-eyebrow'),
  actionDialogTitle: document.getElementById('action-dialog-title'),
  actionDialogMessage: document.getElementById('action-dialog-message'),
  actionDialogCancel: document.getElementById('action-dialog-cancel'),
  actionDialogConfirm: document.getElementById('action-dialog-confirm'),
  importFile: document.getElementById('import-file'),
  storageStatus: document.getElementById('storage-status'),
  accountStatus: document.getElementById('account-status'),
  profileForm: document.getElementById('profile-form'),
  profileNickname: document.getElementById('profile-nickname'),
  profileAvatarFile: document.getElementById('profile-avatar-file'),
  profileAvatarPreview: document.getElementById('profile-avatar-preview'),
  removeProfileAvatar: document.getElementById('remove-profile-avatar'),
  profileFormStatus: document.getElementById('profile-form-status'),
  saveProfile: document.getElementById('save-profile'),
  signupProfileFields: document.getElementById('signup-profile-fields'),
  signupNickname: document.getElementById('signup-nickname'),
  signupAvatarFile: document.getElementById('signup-avatar-file'),
  signupAvatarPreview: document.getElementById('signup-avatar-preview'),
  accountAccessButton: document.getElementById('account-access-button'),
  accountAccessAvatar: document.getElementById('account-access-avatar'),
  accountAccessLabel: document.getElementById('account-access-label'),
  categoryManager: document.getElementById('category-manager'),
  categoryForm: document.getElementById('category-form'),
  categoryName: document.getElementById('category-name'),
  categorySettingsStatus: document.getElementById('category-settings-status'),
  accountEmail: document.getElementById('account-email'),
  accountPassword: document.getElementById('account-password'),
  confirmPassword: document.getElementById('confirm-password'),
  confirmPasswordLabel: document.getElementById('confirm-password-label'),
  authTitle: document.getElementById('auth-title'),
  authIntro: document.getElementById('auth-intro'),
  signIn: document.getElementById('sign-in'),
  signUp: document.getElementById('sign-up'),
  registerAccount: document.getElementById('register-account'),
  switchAuthMode: document.getElementById('switch-auth-mode'),
  recoverPassword: document.getElementById('recover-password'),
  resendConfirmation: document.getElementById('resend-confirmation'),
  saveNewPassword: document.getElementById('save-new-password'),
  authForm: document.getElementById('auth-form'),
  signOut: document.getElementById('sign-out'),
  signedInControls: document.getElementById('signed-in-controls'),
  footerPrivacyLabel: document.getElementById('footer-privacy-label'),
  appFrame: document.querySelector('.app-frame'),
  authGate: document.getElementById('auth-gate'),
  authGateMessage: document.getElementById('auth-gate-message'),
  openAuthModal: document.getElementById('open-auth-modal'),
  authModal: document.getElementById('auth-modal'),
  closeAuthModal: document.getElementById('close-auth-modal'),
  modalAccountStatus: document.getElementById('account-modal-status')
};

function describeAuthError(result, status) {
  const code = result && (result.error_code || result.code);
  const detail = result && (result.msg || result.message || result.error_description || result.error);
  const knownMessages = {
    email_not_confirmed: 'Conferma prima il tuo indirizzo email dal link ricevuto.',
    email_exists: 'Questo indirizzo email è già registrato. Prova ad accedere o recupera la password.',
    invalid_credentials: 'Email o password non corrette.',
    over_email_send_rate_limit: 'Supabase ha raggiunto il limite temporaneo di invio email. Non inviare altre richieste per ora. Controlla Authentication → Users: se l’account esiste ma non è confermato, configura SMTP personalizzato in Supabase prima di chiedere un nuovo invio.',
    weak_password: 'La password non rispetta i requisiti di sicurezza impostati.'
  };
  if (code && knownMessages[code]) return knownMessages[code];
  if (status === 429) return `Supabase ha limitato temporaneamente le richieste.${detail ? ` ${detail}` : ''}`;
  if (status >= 500) return `Il servizio di autenticazione Supabase ha restituito un errore.${detail ? ` ${detail}` : ` (HTTP ${status}).`}`;
  return detail || `Richiesta di autenticazione non riuscita (HTTP ${status}).`;
}

function setAccountStatus(message, isError = false, isSuccess = false, isPending = false) {
  // Mantiene sincronizzati il messaggio nel pannello e quello nella finestra modale.
  elements.accountStatus.textContent = message;
  elements.accountStatus.classList.toggle('is-error', isError);
  elements.accountStatus.classList.toggle('is-success', isSuccess);
  elements.accountStatus.classList.toggle('is-pending', isPending);
  elements.modalAccountStatus.textContent = message;
  elements.modalAccountStatus.classList.toggle('is-error', isError);
  elements.modalAccountStatus.classList.toggle('is-success', isSuccess);
  elements.modalAccountStatus.classList.toggle('is-pending', isPending);
}

function renderAccountAvatar(avatarUrl) {
  elements.accountAccessAvatar.replaceChildren();
  if (avatarUrl) {
    const image = document.createElement('img');
    image.src = avatarUrl;
    image.alt = '';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => {
      if (image.parentNode === elements.accountAccessAvatar) renderAccountAvatar(null);
    }, { once: true });
    elements.accountAccessAvatar.append(image);
    return;
  }
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('aria-hidden', 'true');
  const shoulders = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  shoulders.setAttribute('d', 'M19 20a7 7 0 0 0-14 0');
  shoulders.setAttribute('stroke', 'currentColor');
  shoulders.setAttribute('stroke-width', '1.8');
  shoulders.setAttribute('stroke-linecap', 'round');
  const head = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  head.setAttribute('cx', '12');
  head.setAttribute('cy', '8');
  head.setAttribute('r', '4');
  head.setAttribute('stroke', 'currentColor');
  head.setAttribute('stroke-width', '1.8');
  icon.append(shoulders, head);
  elements.accountAccessAvatar.append(icon);
}

function accountProfile(user) {
  const metadata = user && user.user_metadata && typeof user.user_metadata === 'object'
    ? user.user_metadata
    : {};
  const email = user && typeof user.email === 'string' ? user.email.trim() : '';
  const nameValue = [metadata.nickname, metadata.full_name, metadata.name, metadata.display_name, metadata.preferred_username]
    .find(value => typeof value === 'string' && value.trim());
  const name = nameValue ? nameValue.trim() : email.split('@')[0];
  const avatarValue = metadata.avatar_url || metadata.picture || metadata.avatarUrl;
  let avatarUrl = null;
  if (typeof avatarValue === 'string') {
    try {
      const parsedUrl = new URL(avatarValue);
      if (parsedUrl.protocol === 'https:' && !parsedUrl.username && !parsedUrl.password) {
        avatarUrl = parsedUrl.href;
      }
    } catch {
      avatarUrl = null;
    }
  }
  const avatarPath = typeof metadata.avatar_path === 'string'
    && user && user.id
    && metadata.avatar_path.startsWith(`${user.id}/`)
    && !metadata.avatar_path.includes('..')
    ? metadata.avatar_path
    : null;
  return { name, email, avatarUrl, avatarPath };
}

function setProfileFormStatus(message = '', isError = false, isSuccess = false, isPending = false) {
  elements.profileFormStatus.textContent = message;
  elements.profileFormStatus.hidden = !message;
  elements.profileFormStatus.classList.toggle('is-error', isError);
  elements.profileFormStatus.classList.toggle('is-success', isSuccess);
  elements.profileFormStatus.classList.toggle('is-pending', isPending);
}

function setProfileSavePending(pending) {
  profileSavePending = pending;
  elements.saveProfile.disabled = pending;
  elements.saveProfile.textContent = pending ? 'Salvataggio…' : 'Salva profilo';
  elements.profileNickname.disabled = pending;
  elements.profileAvatarFile.disabled = pending;
  elements.removeProfileAvatar.disabled = pending;
}

function setProfilePreview(container, imageUrl) {
  container.replaceChildren();
  if (!imageUrl) {
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('fill', 'none');
    icon.setAttribute('aria-hidden', 'true');
    const shoulders = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    shoulders.setAttribute('d', 'M19 20a7 7 0 0 0-14 0');
    shoulders.setAttribute('stroke', 'currentColor');
    shoulders.setAttribute('stroke-width', '1.8');
    shoulders.setAttribute('stroke-linecap', 'round');
    const head = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    head.setAttribute('cx', '12');
    head.setAttribute('cy', '8');
    head.setAttribute('r', '4');
    head.setAttribute('stroke', 'currentColor');
    head.setAttribute('stroke-width', '1.8');
    icon.append(shoulders, head);
    container.append(icon);
    return;
  }
  const image = document.createElement('img');
  image.src = imageUrl;
  image.alt = '';
  image.referrerPolicy = 'no-referrer';
  image.addEventListener('error', () => setProfilePreview(container, null), { once: true });
  container.append(image);
}

function populateProfileSettings(user) {
  const metadata = user && user.user_metadata && typeof user.user_metadata === 'object'
    ? user.user_metadata
    : {};
  elements.profileNickname.value = [metadata.nickname, metadata.full_name, metadata.name]
    .find(value => typeof value === 'string' && value.trim())?.trim() || '';
  removeProfileAvatarOnSave = false;
  profileAvatarDraft = null;
  elements.profileAvatarFile.value = '';
  elements.removeProfileAvatar.hidden = !accountProfile(user).avatarPath && !accountProfile(user).avatarUrl;
  elements.removeProfileAvatar.textContent = 'Rimuovi foto';
  if (profileAvatarPreviewUrl) URL.revokeObjectURL(profileAvatarPreviewUrl);
  profileAvatarPreviewUrl = null;
  setProfileFormStatus();
  const profile = accountProfile(user);
  const imageUrl = profile.avatarUrl
    || (resolvedAvatarCache && resolvedAvatarCache.key === `${user.id}:${profile.avatarPath}` ? resolvedAvatarCache.url : null);
  setProfilePreview(elements.profileAvatarPreview, imageUrl);
}

function resolveAccountAvatar(user, profile) {
  if (!profile.avatarPath || !user || !user.id) return;
  const key = `${user.id}:${profile.avatarPath}`;
  if (resolvedAvatarCache && resolvedAvatarCache.key === key && resolvedAvatarCache.expiresAt > Date.now() + 60000) {
    renderAccountAvatar(resolvedAvatarCache.url);
    setProfilePreview(elements.profileAvatarPreview, resolvedAvatarCache.url);
    return;
  }
  if (avatarResolutionKey === key && avatarResolutionPromise) return;
  avatarResolutionKey = key;
  avatarResolutionPromise = getSignedAvatarUrl(profile.avatarPath).then(url => {
    if (avatarResolutionKey !== key || !isAuthenticated || !cloudSession || cloudSession.user.id !== user.id) return;
    resolvedAvatarCache = { key, url, expiresAt: Date.now() + 55 * 60 * 1000 };
    renderAccountAvatar(url);
    setProfilePreview(elements.profileAvatarPreview, url);
  }).catch(error => {
    console.warn('Impossibile caricare la foto profilo privata.', error);
  }).finally(() => {
    if (avatarResolutionKey === key) {
      avatarResolutionPromise = null;
      if (!resolvedAvatarCache || resolvedAvatarCache.key !== key) avatarResolutionKey = '';
    }
  });
}

function updateAccountControls() {
  // L'archivio locale resta utilizzabile anche senza una sessione cloud.
  const signedIn = isAuthenticated;
  const signingUp = authMode === 'signup';
  const profile = accountProfile(signedIn && cloudSession ? cloudSession.user : null);
  elements.appFrame.inert = !isAppReady;
  elements.appFrame.classList.toggle('is-locked', !isAppReady);
  elements.authGate.hidden = isAppReady;
  elements.authGateMessage.textContent = 'Caricamento del tuo archivio locale…';
  elements.accountAccessButton.disabled = !cloudConfigured;
  elements.accountAccessLabel.textContent = signedIn ? (profile.name || 'Account') : cloudConfigured ? 'Accedi' : 'Solo locale';
  renderAccountAvatar(signedIn ? profile.avatarUrl : null);
  if (signedIn && profile.avatarPath) resolveAccountAvatar(cloudSession.user, profile);
  elements.accountAccessButton.setAttribute(
    'aria-label',
    signedIn ? `Apri account${profile.name ? ` di ${profile.name}` : ''}` : cloudConfigured ? 'Accedi al tuo account' : 'Sincronizzazione solo locale'
  );
  elements.accountAccessButton.title = signedIn
    ? [profile.name, profile.email].filter(Boolean).join(' · ')
    : cloudConfigured ? 'Accedi o crea un account per sincronizzare' : 'Archivio salvato su questo dispositivo';
  elements.footerPrivacyLabel.textContent = cloudConfigured
    ? signedIn ? 'Account connesso · Nessun analytics' : 'Solo su questo dispositivo · Nessun analytics'
    : 'Solo sul dispositivo · Nessun analytics';
  elements.signedInControls.hidden = !signedIn;
  document.getElementById('delete-account').hidden = !signedIn || !supabaseConfig.accountDeletionEnabled;
  if (supabaseConfig.accountDeletionEnabled) document.getElementById('delete-account-help').textContent = 'Rimuove definitivamente account, storico, categorie e foto dal servizio attivo. Esporta prima un backup se vuoi conservarlo.';
  elements.signupProfileFields.hidden = !signingUp || signedIn || isPasswordRecovery;
  elements.signupNickname.required = signingUp && !signedIn && !isPasswordRecovery;
  elements.signupNickname.disabled = authRequestPending;
  elements.signupAvatarFile.disabled = authRequestPending;
  elements.saveProfile.disabled = authRequestPending || profileSavePending;
  elements.signOut.hidden = !signedIn || isPasswordRecovery;
  elements.signIn.hidden = signedIn || isPasswordRecovery || signingUp;
  elements.signUp.hidden = signedIn || isPasswordRecovery || signingUp;
  elements.registerAccount.hidden = signedIn || isPasswordRecovery || !signingUp;
  elements.recoverPassword.hidden = signedIn || isPasswordRecovery || signingUp;
  elements.switchAuthMode.hidden = signedIn || isPasswordRecovery || !signingUp;
  elements.switchAuthMode.textContent = signingUp ? 'Torna all’accesso' : 'Non hai un account? Registrati';
  elements.resendConfirmation.hidden = signedIn || isPasswordRecovery || !awaitingEmailConfirmation;
  elements.confirmPasswordLabel.hidden = !signingUp;
  elements.confirmPassword.hidden = !signingUp;
  elements.confirmPassword.required = signingUp;
  elements.authTitle.textContent = isPasswordRecovery
    ? 'Imposta una nuova password'
    : signingUp ? 'Crea il tuo account' : 'Accedi al tuo account';
  elements.authIntro.textContent = isPasswordRecovery
    ? 'Scegli una password nuova per il tuo account.'
    : signingUp
      ? 'Inserisci email e password per creare il tuo account.'
      : 'Collega l’account per sincronizzare i dati locali tra i tuoi dispositivi.';
  elements.signUp.textContent = signingUp ? 'Registrati' : 'Crea account';
  elements.saveNewPassword.hidden = !isPasswordRecovery;
  elements.signIn.disabled = authRequestPending;
  elements.signUp.disabled = authRequestPending;
  elements.registerAccount.disabled = authRequestPending;
  elements.recoverPassword.disabled = authRequestPending;
  elements.resendConfirmation.disabled = authRequestPending;
  elements.saveNewPassword.disabled = authRequestPending;
  elements.accountEmail.disabled = isPasswordRecovery;
  elements.accountPassword.disabled = signedIn && !isPasswordRecovery;
  elements.accountPassword.autocomplete = isPasswordRecovery ? 'new-password' : 'current-password';
}

function openAuthenticationModal() {
  if (!cloudConfigured) {
    setAccountStatus('La sincronizzazione non è configurata. Segui la sezione Supabase nel README.', true);
    return;
  }
  if (!isPasswordRecovery) setAuthMode('signin');
  if (!elements.authModal.open) elements.authModal.showModal();
  if (!isPasswordRecovery) elements.accountEmail.focus();
}

function setAuthMode(mode) {
  authMode = mode;
  elements.accountPassword.value = '';
  elements.confirmPassword.value = '';
  elements.confirmPassword.setCustomValidity('');
  setAccountStatus(mode === 'signup'
    ? 'Crea il tuo account con email e password.'
    : 'Inserisci email e password per continuare.');
  updateAccountControls();
}

function closeAuthenticationModal() {
  if (elements.authModal.open) elements.authModal.close();
}

function saveCloudSession(session) {
  cloudSession = {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at || Math.floor(Date.now() / 1000) + (session.expires_in || 3600),
    user: session.user
  };
  localStorage.setItem(CLOUD_SESSION_KEY, JSON.stringify(cloudSession));
  updateAccountControls();
}

function clearCloudSession() {
  cloudSession = null;
  isAuthenticated = false;
  localStorage.removeItem(CLOUD_SESSION_KEY);
  updateAccountControls();
}

function setAuthRequestPending(pending, action = '') {
  // Disabilita invii ripetuti e mostra chiaramente quale operazione sta aspettando Supabase.
  authRequestPending = pending;
  elements.authForm.setAttribute('aria-busy', String(pending));
  elements.signIn.disabled = pending;
  elements.signUp.disabled = pending;
  elements.registerAccount.disabled = pending;
  elements.recoverPassword.disabled = pending;
  elements.resendConfirmation.disabled = pending;
  elements.saveNewPassword.disabled = pending;
  elements.signupNickname.disabled = pending;
  elements.signupAvatarFile.disabled = pending;
  elements.signIn.textContent = pending && action === 'signin' ? 'Accesso in corso…' : 'Accedi';
  elements.registerAccount.textContent = pending && action === 'signup' ? 'Invio richiesta…' : 'Registrati';
  elements.resendConfirmation.textContent = pending && action === 'resend'
    ? 'Richiesta in corso…'
    : 'Invia di nuovo l’email di conferma';
  elements.signIn.toggleAttribute('aria-busy', pending && action === 'signin');
  elements.registerAccount.toggleAttribute('aria-busy', pending && action === 'signup');
  elements.resendConfirmation.toggleAttribute('aria-busy', pending && action === 'resend');
  if (pending) {
    const pendingMessages = {
      signin: 'Verifica delle credenziali in corso…',
      signup: 'Invio della richiesta di registrazione a Supabase…',
      resend: 'Richiesta di reinvio email in corso…'
    };
    setAccountStatus(pendingMessages[action] || 'Operazione in corso…', false, false, true);
  }
}

async function supabaseAuthRequest(path, body, accessToken, query = {}) {
  // Alcuni endpoint Auth ricevono parametri come redirect_to nella query, non nel JSON.
  const requestUrl = new URL(`/auth/v1/${path}`, supabaseConfig.url);
  Object.entries(query).forEach(([key, value]) => requestUrl.searchParams.set(key, value));
  const response = await fetch(requestUrl.href, {
    method: 'POST',
    headers: {
      apikey: supabaseConfig.anonKey,
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
    },
    body: JSON.stringify(body)
  });
  const responseText = await response.text();
  let result = {};
  if (responseText) {
    try {
      result = JSON.parse(responseText);
    } catch {
      throw new Error(`Risposta di autenticazione non valida (HTTP ${response.status}).`);
    }
  }
  if (!response.ok) {
    const error = new Error(describeAuthError(result, response.status));
    error.authCode = result && (result.error_code || result.code);
    error.authStatus = response.status;
    throw error;
  }
  return result;
}

async function authenticatedStorageRequest(path, options = {}, retry = true) {
  const session = cloudSession;
  if (!session || !session.access_token) throw new Error('Accedi per gestire la foto profilo.');
  const response = await fetch(`${supabaseConfig.url.replace(/\/$/, '')}/storage/v1/${path}`, {
    ...options,
    headers: {
      apikey: supabaseConfig.anonKey,
      Authorization: 'Bearer ' + session.access_token,
      ...(options.headers || {})
    }
  });
  if (response.status === 401 && retry && session.refresh_token) {
    const refreshed = await refreshCloudSession(session.refresh_token);
    saveCloudSession(refreshed);
    return authenticatedStorageRequest(path, options, false);
  }
  const responseText = await response.text();
  let result = null;
  if (responseText) {
    try {
      result = JSON.parse(responseText);
    } catch {
      if (!response.ok) throw new Error(`Storage Supabase non disponibile (HTTP ${response.status}).`);
    }
  }
  if (!response.ok) {
    if (response.status === 404 || (result && ['Bucket not found', 'No such bucket'].includes(result.message))) {
      throw new Error('Lo storage delle foto non è configurato. Esegui lo script supabase-schema.sql aggiornato.');
    }
    throw new Error((result && (result.message || result.error || result.msg)) || `Operazione sulla foto non riuscita (HTTP ${response.status}).`);
  }
  return result;
}

async function getSignedAvatarUrl(avatarPath) {
  const encodedPath = avatarPath.split('/').map(encodeURIComponent).join('/');
  const result = await authenticatedStorageRequest(`object/sign/${AVATAR_BUCKET}/${encodedPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: 3600 })
  });
  if (!result || typeof result.signedURL !== 'string') {
    throw new Error('Supabase non ha restituito un collegamento valido per la foto profilo.');
  }
  if (/^https:\/\//i.test(result.signedURL)) return result.signedURL;
  const baseUrl = supabaseConfig.url.replace(/\/$/, '');
  const signedPath = result.signedURL.startsWith('/')
    ? result.signedURL
    : `/${result.signedURL}`;
  return `${baseUrl}/storage/v1${signedPath}`;
}

async function resizeProfileImage(file) {
  const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
  if (!file || !allowedTypes.has(file.type)) {
    throw new Error('Scegli un’immagine JPG, PNG o WebP.');
  }
  if (file.size > 10 * 1024 * 1024) throw new Error('La foto deve essere più piccola di 10 MB.');
  if (typeof createImageBitmap !== 'function') throw new Error('Questo browser non supporta il ridimensionamento delle immagini.');
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 24000000) throw new Error('La risoluzione dell’immagine è troppo alta.');
    const size = 320;
    const scale = Math.max(size / bitmap.width, size / bitmap.height);
    const sourceWidth = size / scale;
    const sourceHeight = size / scale;
    const sourceX = (bitmap.width - sourceWidth) / 2;
    const sourceY = (bitmap.height - sourceHeight) / 2;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Impossibile elaborare la foto selezionata.');
    context.drawImage(bitmap, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, size, size);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(result => {
        if (result) resolve(result);
        else reject(new Error('Impossibile convertire la foto selezionata.'));
      }, 'image/jpeg', 0.82);
    });
    if (blob.size > 300 * 1024) throw new Error('La foto elaborata supera il limite di 300 KB. Scegli un’altra immagine.');
    return blob;
  } finally {
    bitmap.close();
  }
}

function normalizeProfileEmail(email) {
  return typeof email === 'string' ? email.trim().toLocaleLowerCase('en-US') : '';
}

async function saveProfileDraft(email, blob) {
  const normalizedEmail = normalizeProfileEmail(email);
  if (!normalizedEmail) throw new Error('Inserisci un indirizzo email valido prima di scegliere la foto.');
  const tx = await createDatabaseTransaction('readwrite', PROFILE_DRAFT_STORE_NAME);
  const done = transactionDone(tx);
  tx.objectStore(PROFILE_DRAFT_STORE_NAME).put({ email: normalizedEmail, blob, savedAt: Date.now() });
  await done;
}

async function readProfileDraft(email) {
  const normalizedEmail = normalizeProfileEmail(email);
  if (!normalizedEmail) return null;
  const tx = await createDatabaseTransaction('readonly', PROFILE_DRAFT_STORE_NAME);
  const done = transactionDone(tx);
  const request = tx.objectStore(PROFILE_DRAFT_STORE_NAME).get(normalizedEmail);
  const draft = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error('Impossibile leggere la foto in attesa.'));
  });
  await done;
  return draft;
}

async function deleteProfileDraft(email) {
  const normalizedEmail = normalizeProfileEmail(email);
  if (!normalizedEmail) return;
  const tx = await createDatabaseTransaction('readwrite', PROFILE_DRAFT_STORE_NAME);
  const done = transactionDone(tx);
  tx.objectStore(PROFILE_DRAFT_STORE_NAME).delete(normalizedEmail);
  await done;
}

async function uploadProfileAvatar(blob, userId) {
  const avatarPath = `${userId}/${makeId()}.jpg`;
  const encodedPath = avatarPath.split('/').map(encodeURIComponent).join('/');
  await authenticatedStorageRequest(`object/${AVATAR_BUCKET}/${encodedPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'image/jpeg',
      'x-upsert': 'true'
    },
    body: blob
  });
  return avatarPath;
}

async function updateAuthenticatedUserMetadata(metadata) {
  if (!cloudSession || !cloudSession.access_token) throw new Error('Accedi di nuovo per modificare il profilo.');
  const sendUpdate = async retry => {
    const response = await fetch(`${supabaseConfig.url.replace(/\/$/, '')}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        apikey: supabaseConfig.anonKey,
        Authorization: 'Bearer ' + cloudSession.access_token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ data: metadata })
    });
    if (response.status === 401 && retry && cloudSession.refresh_token) {
      const refreshed = await refreshCloudSession(cloudSession.refresh_token);
      saveCloudSession(refreshed);
      return sendUpdate(false);
    }
    const responseText = await response.text();
    let result = null;
    if (responseText) {
      try {
        result = JSON.parse(responseText);
      } catch {
        throw new Error(`Risposta del profilo non valida (HTTP ${response.status}).`);
      }
    }
    if (!response.ok) {
      throw new Error((result && (result.msg || result.message || result.error_description)) || `Aggiornamento del profilo non riuscito (HTTP ${response.status}).`);
    }
    return result;
  };
  const user = await sendUpdate(true);
  if (!user || !user.id) throw new Error('Supabase non ha restituito il profilo aggiornato.');
  cloudSession.user = user;
  saveCloudSession(cloudSession);
  return user;
}

async function removeStoredAvatar(avatarPath) {
  if (!avatarPath) return;
  await authenticatedStorageRequest(`object/${AVATAR_BUCKET}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: [avatarPath] })
  });
}

async function completePendingProfileSetup(user) {
  if (!user || !user.email || !user.id) return false;
  const draft = await readProfileDraft(user.email);
  if (!draft || !(draft.blob instanceof Blob)) return false;
  const avatarPath = await uploadProfileAvatar(draft.blob, user.id);
  const metadata = { ...(user.user_metadata || {}), nickname: accountProfile(user).name, avatar_path: avatarPath };
  delete metadata.avatar_url;
  delete metadata.picture;
  const updatedUser = await updateAuthenticatedUserMetadata(metadata);
  await deleteProfileDraft(user.email);
  resolvedAvatarCache = null;
  populateProfileSettings(updatedUser);
  updateAccountControls();
  return true;
}

function isInvalidRefreshTokenError(error) {
  return error.authStatus === 400
    && (error.authCode === 'refresh_token_not_found'
      || /invalid refresh token|refresh token.*not found/i.test(error.message));
}

async function refreshCloudSession(refreshToken) {
  try {
    return await supabaseAuthRequest('token?grant_type=refresh_token', { refresh_token: refreshToken });
  } catch (error) {
    if (isInvalidRefreshTokenError(error)) {
      // El token rifiutato non va ritentato: rimuove solo la sessione locale, non i dati cloud.
      isPasswordRecovery = false;
      clearCloudSession();
      openAuthenticationModal();
      setAccountStatus('Supabase ha rifiutato la sessione salvata su questo dispositivo. Ho rimosso la sessione locale; lo storico online non è stato cancellato. Accedi di nuovo con email e password.', true);
      error.authSessionCleared = true;
    }
    throw error;
  }
}

async function supabaseRequest(path, options = {}, retry = true) {
  const response = await fetch(`${supabaseConfig.url.replace(/\/$/, '')}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: supabaseConfig.anonKey,
      Authorization: `Bearer ${cloudSession.access_token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (response.status === 401 && retry && cloudSession.refresh_token) {
    // Aggiorna una sola volta il token scaduto e ripete la stessa richiesta.
    const refreshed = await refreshCloudSession(cloudSession.refresh_token);
    saveCloudSession(refreshed);
    return supabaseRequest(path, options, false);
  }
  const responseText = await response.text();
  let result = null;
  if (responseText) {
    try {
      result = JSON.parse(responseText);
    } catch {
      throw new Error(`Risposta del database non valida (HTTP ${response.status}).`);
    }
  }
  if (!response.ok) {
    const schemaErrorCodes = new Set(['PGRST202', 'PGRST204', 'PGRST205', '42P01', '42883']);
    if ((path.includes('smokelog_events') || path.includes('smokelog_purchases') || path.includes('smokelog_categories') || path.includes('merge_smokelog_data'))
      && result && schemaErrorCodes.has(result.code)) {
      throw new Error('Lo schema Supabase non è aggiornato. Esegui il file supabase-schema.sql nel SQL Editor del progetto, poi riprova.');
    }
    const error = new Error((result && (result.message || result.details || result.hint)) || `Operazione cloud non riuscita (HTTP ${response.status}).`);
    error.code = result && result.code;
    throw error;
  }
  return result;
}

async function fetchCloudEvents() {
  const eventsFromCloud = [];
  // Legge tutte le pagine: una singola risposta potrebbe non contenere l'intero storico.
  for (let start = 0; ; start += CLOUD_BATCH_SIZE) {
    const rows = await supabaseRequest('smokelog_events?select=id,type,timestamp,updated_at,deleted_at&order=timestamp.asc', {
      headers: {
        Range: `${start}-${start + CLOUD_BATCH_SIZE - 1}`,
        'Range-Unit': 'items'
      }
    });
    eventsFromCloud.push(...rows.map(row => ({
      id: row.id,
      type: row.type,
      timestamp: row.timestamp,
      updatedAt: row.updated_at || row.timestamp,
      deletedAt: row.deleted_at || null
    })));
    if (rows.length < CLOUD_BATCH_SIZE) break;
  }
  return eventsFromCloud;
}

async function fetchCloudPurchases() {
  const purchasesFromCloud = [];
  for (let start = 0; ; start += CLOUD_BATCH_SIZE) {
    const rows = await supabaseRequest('smokelog_purchases?select=id,type,amount,timestamp,updated_at,deleted_at&order=timestamp.asc', {
      headers: {
        Range: `${start}-${start + CLOUD_BATCH_SIZE - 1}`,
        'Range-Unit': 'items'
      }
    });
    purchasesFromCloud.push(...rows.map(row => ({
      id: row.id,
      type: row.type,
      amountCents: Math.round(Number(row.amount) * 100),
      timestamp: row.timestamp,
      updatedAt: row.updated_at || row.timestamp,
      deletedAt: row.deleted_at || null
    })));
    if (rows.length < CLOUD_BATCH_SIZE) break;
  }
  return purchasesFromCloud;
}

async function fetchCloudCategories() {
  const categoriesFromCloud = [];
  for (let start = 0; ; start += CLOUD_BATCH_SIZE) {
    const rows = await supabaseRequest('smokelog_categories?select=id,name,color,position,is_active,updated_at,deleted_at&order=position.asc', {
      headers: {
        Range: `${start}-${start + CLOUD_BATCH_SIZE - 1}`,
        'Range-Unit': 'items'
      }
    });
    categoriesFromCloud.push(...rows.map(row => ({
      id: row.id,
      name: row.name,
      color: row.color,
      position: row.position,
      isActive: row.is_active,
      updatedAt: row.updated_at,
      deletedAt: row.deleted_at || null
    })));
    if (rows.length < CLOUD_BATCH_SIZE) break;
  }
  return categoriesFromCloud;
}

function mergeById(...sources) {
  const records = new Map();
  for (const source of sources) {
    for (const record of source) {
      const existing = records.get(record.id);
      const currentTime = Date.parse(record.updatedAt || record.timestamp) || 0;
      const existingTime = existing ? Date.parse(existing.updatedAt || existing.timestamp) || 0 : -1;
      if (!existing || currentTime >= existingTime) records.set(record.id, record);
    }
  }
  return [...records.values()];
}

async function readCloudSnapshot(userId) {
  const tx = await createDatabaseTransaction('readonly', SYNC_STORE_NAME);
  const done = transactionDone(tx);
  const request = tx.objectStore(SYNC_STORE_NAME).get(userId);
  let cached;
  request.onsuccess = () => { cached = request.result; };
  await done;
  return cached || { ownerId: userId, cursor: '0', events: [], purchases: [], categories: [] };
}

async function fetchCloudSnapshot(userId, cached = null) {
  const snapshot = cached || await readCloudSnapshot(userId);
  // Old deployments continue to work until the incremental SQL migration is run.
  try {
    let more = true;
    while (more) {
      const page = await supabaseRequest('rpc/smokelog_changes', {
        method: 'POST', body: JSON.stringify({ p_after: snapshot.cursor, p_limit: CLOUD_BATCH_SIZE })
      });
      for (const kind of ['events', 'purchases', 'categories']) {
        const byId = new Map(snapshot[kind].map(record => [record.id, record]));
        for (const change of page.changes.filter(change => change.kind === kind)) {
          const row = change.record;
          const record = { id: row.id, updatedAt: row.updated_at, deletedAt: row.deleted_at || null };
          if (kind === 'categories') Object.assign(record, { name: row.name, color: row.color, position: row.position, isActive: row.is_active });
          else Object.assign(record, { type: row.type, timestamp: row.timestamp });
          if (kind === 'purchases') record.amountCents = Math.round(Number(row.amount) * 100);
          byId.set(record.id, record);
        }
        snapshot[kind] = [...byId.values()];
      }
      if (page.has_more && page.cursor === snapshot.cursor) throw new Error('Il cursore della sincronizzazione non avanza.');
      snapshot.cursor = page.cursor;
      more = page.has_more;
    }
    return snapshot;
  } catch (error) {
    if (!['PGRST202', '42883'].includes(error.code)) throw error;
    const [events, purchases, categories] = await Promise.all([fetchCloudEvents(), fetchCloudPurchases(), fetchCloudCategories()]);
    return { ownerId: userId, cursor: '0', events, purchases, categories };
  }
}

function mergeCategoriesById(localCategories, remoteCategories) {
  const merged = new Map(mergeById(localCategories, remoteCategories).map(category => [category.id, category]));
  // Una modifica locale non ancora confermata dal cloud deve prevalere anche
  // se l'altro dispositivo ha un updated_at più recente o l'orologio locale
  // non è perfettamente sincronizzato.
  for (const category of localCategories) {
    if (category.pendingSync) {
      const remote = remoteCategories.find(item => item.id === category.id);
      const updatedAt = new Date(Math.max(
        Date.parse(category.updatedAt) || 0,
        (remote ? Date.parse(remote.updatedAt) || 0 : 0) + (categoryStateMatches(category, remote) ? 0 : 1)
      )).toISOString();
      merged.set(category.id, { ...category, updatedAt });
    }
  }
  return [...merged.values()];
}

function categoryStateMatches(first, second) {
  return Boolean(second) && first.name === second.name && first.color === second.color
    && first.position === second.position && first.isActive === second.isActive
    && (first.deletedAt || null) === (second.deletedAt || null);
}

function isUntouchedDefaultCategory(category) {
  const index = DEFAULT_EVENT_CATEGORIES.findIndex(item => item.id === category.id);
  return index >= 0 && !category.pendingSync && categoryStateMatches(category, {
    ...DEFAULT_EVENT_CATEGORIES[index], position: index, isActive: true
  });
}

function withCloudIds(records) {
  const now = new Date().toISOString();
  return records.map(record => {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(record.id)) return record;
    return { ...record, id: makeId(), updatedAt: now };
  });
}

function markLocalMutation() {
  localMutationVersion += 1;
}

async function uploadCloudData(nextEvents, nextPurchases, nextCategories) {
  const batchCount = Math.ceil(Math.max(nextEvents.length, nextPurchases.length, nextCategories.length) / CLOUD_BATCH_SIZE);
  for (let batch = 0; batch < batchCount; batch += 1) {
    const start = batch * CLOUD_BATCH_SIZE;
    await supabaseRequest('rpc/merge_smokelog_data', {
      method: 'POST',
      body: JSON.stringify({
        p_events: nextEvents.slice(start, start + CLOUD_BATCH_SIZE).map(event => ({
          id: event.id,
          type: event.type,
          timestamp: event.timestamp,
          updated_at: event.updatedAt || event.timestamp,
          deleted_at: event.deletedAt || null
        })),
        p_purchases: nextPurchases.slice(start, start + CLOUD_BATCH_SIZE).map(purchase => ({
          id: purchase.id,
          type: purchase.type,
          amount: purchase.amountCents / 100,
          timestamp: purchase.timestamp,
          updated_at: purchase.updatedAt || purchase.timestamp,
          deleted_at: purchase.deletedAt || null
        })),
        p_categories: nextCategories.slice(start, start + CLOUD_BATCH_SIZE).map(category => ({
          id: category.id,
          name: category.name,
          color: category.color,
          position: category.position,
          is_active: Boolean(category.isActive),
          updated_at: category.updatedAt,
          deleted_at: category.deletedAt || null
        }))
      })
    });
  }
}

function syncCloudEvents() {
  // Accorpa le sincronizzazioni concorrenti, ma programma un altro passaggio
  // se nel frattempo l'utente ha modificato lo storico locale.
  if (cloudSyncPromise) {
    cloudSyncNeedsAnotherPass = true;
    return cloudSyncPromise;
  }
  cloudSyncPromise = (async () => {
    do {
      cloudSyncNeedsAnotherPass = false;
      const syncVersion = localMutationVersion;
      await performCloudSync(syncVersion);
      if (localMutationVersion !== syncVersion) cloudSyncNeedsAnotherPass = true;
    } while (cloudSyncNeedsAnotherPass);
  })().finally(() => {
    cloudSyncPromise = null;
  });
  return cloudSyncPromise;
}

function requestCloudSync() {
  if (!cloudConfigured || !cloudSession || !cloudSession.user || !cloudSession.user.id) return;
  clearTimeout(cloudSyncTimer);
  cloudSyncTimer = setTimeout(() => {
    void syncCloudEvents().catch(error => {
      console.error(error);
      const detail = error instanceof Error && error.message ? ` ${error.message}` : '';
      setAccountStatus(`Salvato sul dispositivo. Sincronizzazione in attesa.${detail}`, false, false, true);
    });
  }, 250);
}

async function performCloudSync(syncVersion) {
  if (!cloudSession || !cloudSession.user || !cloudSession.user.id) {
    throw new Error('La sessione non contiene un account valido. Accedi di nuovo.');
  }
  const userId = cloudSession.user.id;
  const ensureSessionActive = () => {
    if (!cloudSession || !cloudSession.user || cloudSession.user.id !== userId) {
      throw new Error('La sessione è terminata durante la sincronizzazione. Accedi di nuovo.');
    }
  };
  const [accountEvents, guestEvents, accountPurchases, guestPurchases, accountCategories, guestCategories] = await Promise.all([
    readAllEvents(userId, true),
    readAllEvents(GUEST_OWNER_ID, true),
    readAllPurchases(userId, true),
    readAllPurchases(GUEST_OWNER_ID, true),
    readAllCategories(userId, true),
    readAllCategories(GUEST_OWNER_ID, true)
  ]);
  ensureSessionActive();
  const remoteSnapshot = await fetchCloudSnapshot(userId);
  const { events: remoteEvents, purchases: remotePurchases, categories: remoteCategories } = remoteSnapshot;
  ensureSessionActive();
  const timestamp = new Date().toISOString();
  const defaults = DEFAULT_EVENT_CATEGORIES.map((category, index) => ({
    ...category,
    position: index,
    isActive: true,
    updatedAt: timestamp,
    deletedAt: null
  }));
  const localEvents = withCloudIds([...accountEvents, ...guestEvents]);
  const localPurchases = withCloudIds([...accountPurchases, ...guestPurchases]);
  // I default guest ricreati all'avvio non sono modifiche dell'utente.
  const localCategories = [...accountCategories, ...guestCategories.filter(category => !isUntouchedDefaultCategory(category))];
  const nextEvents = mergeById(localEvents, remoteEvents);
  const nextPurchases = mergeById(localPurchases, remotePurchases);
  const mergedCategoriesBeforeDefaults = mergeCategoriesById(localCategories, remoteCategories);
  const knownCategoryIds = new Set(mergedCategoriesBeforeDefaults.map(category => category.id));
  const nextCategories = [...mergedCategoriesBeforeDefaults, ...defaults.filter(category => !knownCategoryIds.has(category.id))]
    .filter(category => !category.deletedAt);
  await uploadCloudData(
    recordsNeedingUpload(nextEvents, remoteEvents),
    recordsNeedingUpload(nextPurchases, remotePurchases),
    recordsNeedingUpload(nextCategories, remoteCategories)
  );
  ensureSessionActive();
  const finalSnapshot = await fetchCloudSnapshot(userId, remoteSnapshot);
  const { events: finalEvents, purchases: finalPurchases, categories: finalCategories } = finalSnapshot;
  const mergedEvents = mergeById(nextEvents, finalEvents);
  const mergedPurchases = mergeById(nextPurchases, finalPurchases);
  const mergedCategories = mergeCategoriesById(nextCategories, finalCategories);

  // Rileggiamo l'archivio locale subito prima del commit. Se una registrazione
  // è stata aggiunta, modificata o rimossa durante il giro cloud, la includiamo
  // nella fotografia finale e lasciamo che il passaggio successivo la invii.
  const [latestAccountEvents, latestGuestEvents, latestAccountPurchases, latestGuestPurchases, latestAccountCategories, latestGuestCategories] = await Promise.all([
    readAllEvents(userId, true),
    readAllEvents(GUEST_OWNER_ID, true),
    readAllPurchases(userId, true),
    readAllPurchases(GUEST_OWNER_ID, true),
    readAllCategories(userId, true),
    readAllCategories(GUEST_OWNER_ID, true)
  ]);
  if (localMutationVersion !== syncVersion) {
    cloudSyncNeedsAnotherPass = true;
    return;
  }

  const latestLocalEvents = withCloudIds([...latestAccountEvents, ...latestGuestEvents]);
  const latestLocalPurchases = withCloudIds([...latestAccountPurchases, ...latestGuestPurchases]);
  const latestLocalCategories = [...latestAccountCategories, ...latestGuestCategories.filter(category => !isUntouchedDefaultCategory(category))];
  const committedEvents = mergeById(mergedEvents, latestLocalEvents);
  const committedPurchases = mergeById(mergedPurchases, latestLocalPurchases);
  const committedCategories = mergeCategoriesById(mergedCategories, latestLocalCategories);
  const syncedCategories = committedCategories.map(category => ({
    ...category,
    pendingSync: !categoryStateMatches(category, finalCategories.find(item => item.id === category.id))
  }));

  ensureSessionActive();
  const committed = await commitArchive(userId,
    [committedEvents, committedPurchases, syncedCategories],
    [latestAccountEvents, latestAccountPurchases, latestAccountCategories],
    [latestGuestEvents, latestGuestPurchases, latestGuestCategories], finalSnapshot);
  if (localMutationVersion === syncVersion) {
    // Elimina il fallback solo se il cloud ha davvero restituito lo stesso
    // stato. Se Supabase conserva ancora il valore precedente, la preferenza
    // locale resta pending e protegge il pulsante al prossimo caricamento.
    clearCategoryPreferences(userId, finalCategories);
    clearCategoryPreferences(GUEST_OWNER_ID, finalCategories);
  }
  if (localMutationVersion !== syncVersion) cloudSyncNeedsAnotherPass = true;
  ensureSessionActive();
  activeOwnerId = userId;
  events = committed[0].filter(event => !event.deletedAt).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  purchases = committed[1].filter(purchase => !purchase.deletedAt).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  categories = committed[2].filter(category => !category.deletedAt).sort((a, b) => a.position - b.position);
  render();
  localStorage.setItem(LAST_SYNC_USER_KEY, userId);
  isAuthenticated = true;
  isAppReady = true;
  populateProfileSettings(cloudSession.user);
  updateAccountControls();
  closeAuthenticationModal();
  setAccountStatus(`Sincronizzato con l’account ${cloudSession.user.email}.`);
}

async function handleSignIn() {
  if (authRequestPending || !elements.accountEmail.reportValidity() || !elements.accountPassword.reportValidity()) return;
  setAuthRequestPending(true, 'signin');
  try {
    const result = await supabaseAuthRequest('token?grant_type=password', {
      email: elements.accountEmail.value.trim(),
      password: elements.accountPassword.value
    });
    if (!result.access_token || !result.refresh_token || !result.user || !result.user.id) {
      throw new Error('Supabase non ha restituito una sessione valida. Riprova ad accedere.');
    }
    saveCloudSession(result);
    try {
      await syncCloudEvents();
    } catch (error) {
      throw new Error(`Accesso effettuato, ma sincronizzazione non riuscita: ${error.message || 'controlla la connessione e la configurazione del database.'}`);
    }
    try {
      if (await completePendingProfileSetup(cloudSession.user)) {
        setAccountStatus('Accesso effettuato. Foto profilo applicata.');
      }
    } catch (error) {
      console.error(error);
      setAccountStatus(`Accesso riuscito, ma la foto profilo in attesa non è stata caricata: ${error.message || 'riprova dalle impostazioni account.'}`, true);
    }
    elements.accountPassword.value = '';
    awaitingEmailConfirmation = false;
  } catch (error) {
    console.error(error);
    if (error.authCode === 'email_not_confirmed') awaitingEmailConfirmation = true;
    updateAccountControls();
    setAccountStatus(error.message || 'Accesso non riuscito.', true);
  } finally {
    setAuthRequestPending(false);
  }
}

async function handleSignUp() {
  if (authRequestPending || authMode !== 'signup') return;
  const nickname = elements.signupNickname.value.trim();
  elements.signupNickname.setCustomValidity(nickname ? '' : 'Inserisci il nickname da mostrare nel profilo.');
  elements.confirmPassword.setCustomValidity(
    elements.confirmPassword.value === elements.accountPassword.value ? '' : 'Le password non corrispondono.'
  );
  if (!elements.accountEmail.reportValidity()
    || !elements.accountPassword.reportValidity()
    || !elements.signupNickname.reportValidity()
    || !elements.confirmPassword.reportValidity()) return;
  setAuthRequestPending(true, 'signup');
  const email = elements.accountEmail.value.trim();
  const hasSignupAvatar = Boolean(elements.signupAvatarFile.files && elements.signupAvatarFile.files[0]);
  let signupAccepted = false;
  try {
    if (hasSignupAvatar) {
      signupAvatarDraft = await resizeProfileImage(elements.signupAvatarFile.files[0]);
      await saveProfileDraft(email, signupAvatarDraft);
    }
    // Con la conferma email attiva Supabase crea l'utente senza restituire una sessione.
    const result = await supabaseAuthRequest('signup', {
      email,
      password: elements.accountPassword.value,
      data: { nickname, full_name: nickname }
    }, null, { redirect_to: new URL('./', location.href).href });
    if (result.access_token) {
      if (!result.refresh_token || !result.user || !result.user.id) {
        throw new Error('Supabase non ha restituito una sessione valida per il nuovo account.');
      }
      signupAccepted = true;
      awaitingEmailConfirmation = false;
      saveCloudSession(result);
      elements.accountPassword.value = '';
      elements.confirmPassword.value = '';
      elements.signupNickname.value = '';
      elements.signupAvatarFile.value = '';
      if (signupAvatarPreviewUrl) URL.revokeObjectURL(signupAvatarPreviewUrl);
      signupAvatarPreviewUrl = null;
      signupAvatarDraft = null;
      try {
        await syncCloudEvents();
      } catch (error) {
        throw new Error(`Account creato e accesso effettuato, ma sincronizzazione non riuscita: ${error.message || 'controlla la connessione e la configurazione del database.'}`);
      }
      try {
        if (await completePendingProfileSetup(cloudSession.user)) {
          setAccountStatus(`Account creato. Profilo di ${nickname} e foto salvati.`);
        }
      } catch (error) {
        console.error(error);
        setAccountStatus(`Account creato, ma la foto profilo non è stata caricata: ${error.message || 'riprova dalle impostazioni account.'}`, true);
      }
      return;
    }
    if (!result.user || !result.user.id) {
      throw new Error('Supabase non ha confermato la creazione dell’account. Riprova e controlla Authentication → Logs nel progetto.');
    }
    signupAccepted = true;
    awaitingEmailConfirmation = true;
    authMode = 'signin';
    updateAccountControls();
    elements.accountPassword.value = '';
    elements.confirmPassword.value = '';
    elements.signupNickname.value = '';
    elements.signupAvatarFile.value = '';
    if (signupAvatarPreviewUrl) URL.revokeObjectURL(signupAvatarPreviewUrl);
    signupAvatarPreviewUrl = null;
    signupAvatarDraft = null;
    if (result.user && Array.isArray(result.user.identities) && result.user.identities.length === 0) {
      await deleteProfileDraft(email);
      setAccountStatus('Questo indirizzo risulta già registrato: ripetere la registrazione non invia necessariamente una nuova email. Se l’account non è ancora confermato, usa il pulsante qui sotto per richiedere un nuovo messaggio. Se è già confermato, torna all’accesso.', false, true);
      return;
    }
    setAccountStatus(`Profilo di ${nickname} salvato. Supabase ha accettato la registrazione; questo non garantisce che l’email sia stata consegnata. Controlla posta in arrivo e spam. ${hasSignupAvatar ? 'La foto selezionata è in attesa su questo dispositivo e verrà caricata al primo accesso.' : ''}`, false, true);
  } catch (error) {
    console.error(error);
    if (!signupAccepted) {
      try {
        await deleteProfileDraft(email);
      } catch (draftError) {
        console.error('Impossibile rimuovere la foto di registrazione in attesa.', draftError);
      }
    }
    setAccountStatus(error.message || 'Creazione account non riuscita.', true);
  } finally {
    setAuthRequestPending(false);
  }
}

async function saveProfileSettings(event) {
  event.preventDefault();
  if (profileSavePending || !isAuthenticated || !cloudSession || !cloudSession.user) return;
  const nickname = elements.profileNickname.value.trim();
  if (!nickname || nickname.length > 32) {
    elements.profileNickname.setCustomValidity('Inserisci un nickname da 1 a 32 caratteri.');
    elements.profileNickname.reportValidity();
    return;
  }
  elements.profileNickname.setCustomValidity('');
  setProfileSavePending(true);
  setProfileFormStatus('Salvataggio del profilo…', false, false, true);
  const user = cloudSession.user;
  const oldAvatarPath = accountProfile(user).avatarPath;
  const shouldRemoveOldAvatar = Boolean(profileAvatarDraft || removeProfileAvatarOnSave);
  let uploadedAvatarPath = null;
  try {
    let nextMetadata = { ...(user.user_metadata || {}), nickname, full_name: nickname };
    if (profileAvatarDraft) {
      const resizedAvatar = await resizeProfileImage(profileAvatarDraft);
      uploadedAvatarPath = await uploadProfileAvatar(resizedAvatar, user.id);
      nextMetadata.avatar_path = uploadedAvatarPath;
      delete nextMetadata.avatar_url;
      delete nextMetadata.picture;
    } else if (removeProfileAvatarOnSave) {
      delete nextMetadata.avatar_path;
      delete nextMetadata.avatar_url;
      delete nextMetadata.picture;
    }
    const updatedUser = await updateAuthenticatedUserMetadata(nextMetadata);
    resolvedAvatarCache = null;
    populateProfileSettings(updatedUser);
    updateAccountControls();
    let cleanupWarning = '';
    if (oldAvatarPath && oldAvatarPath !== uploadedAvatarPath && shouldRemoveOldAvatar) {
      try {
        await removeStoredAvatar(oldAvatarPath);
      } catch (error) {
        console.warn('Profilo aggiornato, ma non è stato possibile rimuovere la foto precedente.', error);
        cleanupWarning = ' La foto precedente non è stata rimossa dallo storage.';
      }
    }
    setProfileFormStatus(`Profilo aggiornato.${cleanupWarning}`, Boolean(cleanupWarning), !cleanupWarning);
  } catch (error) {
    if (uploadedAvatarPath) {
      try {
        await removeStoredAvatar(uploadedAvatarPath);
      } catch (cleanupError) {
        console.warn('Impossibile rimuovere la nuova foto dopo un salvataggio profilo non riuscito.', cleanupError);
      }
    }
    console.error(error);
    setProfileFormStatus(error.message || 'Impossibile aggiornare il profilo.', true);
  } finally {
    setProfileSavePending(false);
  }
}

async function handleResendConfirmation() {
  if (authRequestPending || !elements.accountEmail.reportValidity()) return;
  setAuthRequestPending(true, 'resend');
  try {
    await supabaseAuthRequest('resend', {
      type: 'signup',
      email: elements.accountEmail.value.trim()
    }, null, { redirect_to: new URL('./', location.href).href });
    setAccountStatus('Supabase ha accettato il reinvio. Controlla posta in arrivo e spam; l’accettazione non garantisce la consegna. Verifica Authentication → Logs e SMTP in Supabase.', false, true);
  } catch (error) {
    console.error(error);
    setAccountStatus(error.message || 'Non è stato possibile richiedere un nuovo messaggio di conferma.', true);
  } finally {
    setAuthRequestPending(false);
  }
}

async function handlePasswordRecovery() {
  if (!elements.accountEmail.reportValidity()) return;
  try {
    const response = await fetch(`${supabaseConfig.url.replace(/\/$/, '')}/auth/v1/recover?redirect_to=${encodeURIComponent(new URL('./', location.href).href)}`, {
      method: 'POST',
      headers: { apikey: supabaseConfig.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: elements.accountEmail.value.trim() })
    });
    if (!response.ok) throw new Error(`Richiesta di recupero non riuscita (HTTP ${response.status}).`);
    setAccountStatus('Se l’indirizzo è registrato, riceverai un link per impostare una nuova password.');
  } catch (error) {
    console.error(error);
    setAccountStatus(error.message || 'Richiesta di recupero non riuscita.', true);
  }
}

async function handleSaveNewPassword() {
  if (authRequestPending || !elements.accountPassword.reportValidity() || !cloudSession) return;
  setAuthRequestPending(true);
  try {
    const response = await fetch(`${supabaseConfig.url.replace(/\/$/, '')}/auth/v1/user`, {
      method: 'PUT',
      headers: {
        apikey: supabaseConfig.anonKey,
        Authorization: `Bearer ${cloudSession.access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ password: elements.accountPassword.value })
    });
    if (!response.ok) throw new Error(`Aggiornamento password non riuscito (HTTP ${response.status}).`);
    elements.accountPassword.value = '';
    isPasswordRecovery = false;
    await syncCloudEvents();
    setAccountStatus('Password aggiornata. Lo storico resta associato al tuo account.');
  } catch (error) {
    console.error(error);
    setAccountStatus(error.message || 'Aggiornamento password non riuscito.', true);
  } finally {
    setAuthRequestPending(false);
  }
}

async function handleSignOut() {
  const session = cloudSession;
  clearCloudSession();
  isAuthenticated = false;
  activeOwnerId = GUEST_OWNER_ID;
  events = [];
  purchases = [];
  categories = [];
  render();
  updateAccountControls();
  try {
    events = await readAllEvents(GUEST_OWNER_ID);
    purchases = await readAllPurchases(GUEST_OWNER_ID);
    categories = await loadCategoriesForOwner(GUEST_OWNER_ID);
    render();
    updateAccountControls();
    closeAuthenticationModal();
    if (session && session.access_token) {
      try {
        await supabaseAuthRequest('logout', {}, session.access_token);
      } catch (error) {
        console.warn('Sessione rimossa da questo dispositivo, ma la revoca remota non è stata confermata.', error);
        setAccountStatus('Disconnesso da questo dispositivo. La revoca remota non è stata confermata; lo storico online resta nel tuo account.', true);
        return;
      }
    }
    setAccountStatus('Disconnesso da questo dispositivo. I dati locali e lo storico online sono conservati.');
  } catch (error) {
    console.error(error);
    setAccountStatus(`Disconnesso, ma non è stato possibile caricare l’archivio locale: ${error.message || 'errore sconosciuto'}`, true);
  }
}

async function handleDeleteAccount() {
  if (!cloudSession?.user?.id || !supabaseConfig.accountDeletionEnabled) return;
  const userId = cloudSession.user.id;
  const email = cloudSession.user.email;
  const approved = await openActionDialog({
    title: 'Eliminare definitivamente l’account?',
    message: `L’account ${email}, lo storico cloud e le foto verranno eliminati. Non potrai recuperarli accedendo di nuovo. Le copie su altri dispositivi e i backup esportati vanno cancellati separatamente.`,
    confirmLabel: 'Elimina definitivamente', danger: true
  });
  if (!approved || cloudSession?.user?.id !== userId) return;
  const button = document.getElementById('delete-account');
  button.disabled = true;
  let remoteDeleted = false;
  try {
    if (cloudSyncPromise) await cloudSyncPromise.catch(() => {});
    if (cloudSession?.user?.id !== userId) throw new Error('L’account è cambiato. Riprova.');
    if (Number(cloudSession.expires_at) < Date.now() / 1000 + 60) saveCloudSession(await refreshCloudSession(cloudSession.refresh_token));
    const response = await fetch(`${supabaseConfig.url.replace(/\/$/, '')}/functions/v1/delete-account`, {
      method: 'POST', headers: { apikey: supabaseConfig.anonKey, Authorization: `Bearer ${cloudSession.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmation: 'DELETE_ACCOUNT' })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.deleted) throw new Error(result.error || 'Cancellazione non completata. Riprova o contatta il supporto.');
    remoteDeleted = true;
    clearCloudSession();
    const tx = await createDatabaseTransaction('readwrite', [STORE_NAME, PURCHASE_STORE_NAME, CATEGORY_STORE_NAME, SYNC_STORE_NAME, PROFILE_DRAFT_STORE_NAME]);
    const done = transactionDone(tx);
    for (const storeName of [STORE_NAME, PURCHASE_STORE_NAME, CATEGORY_STORE_NAME]) {
      const store = tx.objectStore(storeName);
      const request = store.index('ownerId').getAllKeys(userId);
      request.onsuccess = () => request.result.forEach(key => store.delete(key));
    }
    tx.objectStore(SYNC_STORE_NAME).delete(userId);
    if (email) tx.objectStore(PROFILE_DRAFT_STORE_NAME).delete(email.toLowerCase());
    await done;
    localStorage.removeItem(GOALS_KEY + userId);
    localStorage.removeItem(LAST_SYNC_USER_KEY);
    const preferences = readCategoryPreferences();
    delete preferences[userId];
    localStorage.setItem(CATEGORY_PREFERENCES_KEY, JSON.stringify(preferences));
    await activateGuestArchive();
    showToast('Account e dati cloud eliminati.');
  } catch (error) {
    if (remoteDeleted) await activateGuestArchive();
    await openActionDialog({ title: remoteDeleted ? 'Account eliminato' : 'Cancellazione non completata',
      message: remoteDeleted ? 'I dati cloud sono stati eliminati, ma la pulizia locale non è completa. Rimuovi i dati del sito dalle impostazioni del browser.' : error.message, notice: true });
  } finally { button.disabled = false; }
}

async function activateGuestArchive() {
  activeOwnerId = GUEST_OWNER_ID;
  isAuthenticated = false;
  events = [];
  purchases = [];
  categories = [];
  render();
  updateAccountControls();
  events = await readAllEvents(GUEST_OWNER_ID);
  purchases = await readAllPurchases(GUEST_OWNER_ID);
  categories = await loadCategoriesForOwner(GUEST_OWNER_ID);
  render();
  updateAccountControls();
}

function restoreCloudSession() {
  // Evita che l'avvio e gli eventi di visibilità ripristinino la stessa sessione insieme.
  if (authRestorePromise) return authRestorePromise;
  authRestorePromise = restoreCloudSessionFromUrl().finally(() => {
    authRestorePromise = null;
  });
  return authRestorePromise;
}

async function restoreCloudSessionFromUrl() {
  let stored = localStorage.getItem(CLOUD_SESSION_KEY);
  // Supabase può restituire token nell'hash oppure un token_hash nella query del link email.
  const returnedParams = new URLSearchParams(location.search.slice(1));
  new URLSearchParams(location.hash.slice(1)).forEach((value, key) => returnedParams.set(key, value));
  isPasswordRecovery = returnedParams.get('type') === 'recovery';
  const authError = returnedParams.get('error_description')
    || returnedParams.get('msg')
    || returnedParams.get('error_code')
    || returnedParams.get('error');
  if (authError) {
    history.replaceState(null, '', `${location.pathname}`);
    openAuthenticationModal();
    setAccountStatus(`Conferma o accesso non riuscito: ${authError}`, true);
    return;
  }

  const returnedAccessToken = returnedParams.get('access_token');
  const returnedRefreshToken = returnedParams.get('refresh_token');
  if (returnedAccessToken && returnedRefreshToken) {
    openAuthenticationModal();
    saveCloudSession({
      access_token: returnedAccessToken,
      refresh_token: returnedRefreshToken,
      expires_in: Number(returnedParams.get('expires_in')) || 3600,
      user: null
    });
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    stored = localStorage.getItem(CLOUD_SESSION_KEY);
  } else if (returnedParams.has('token_hash') && returnedParams.has('type')) {
    // Verifica i link email monouso prima di salvarne la sessione restituita.
    const tokenType = returnedParams.get('type');
    const supportedTokenTypes = new Set(['signup', 'invite', 'magiclink', 'recovery', 'email_change']);
    if (!supportedTokenTypes.has(tokenType)) {
      history.replaceState(null, '', location.pathname);
      setAccountStatus('Il link di conferma contiene un tipo di token non supportato. Richiedi un nuovo link.', true);
      return;
    }
    isPasswordRecovery = tokenType === 'recovery';
    try {
      const verified = await supabaseAuthRequest('verify', {
        type: tokenType,
        token_hash: returnedParams.get('token_hash')
      });
      if (!verified.access_token || !verified.refresh_token) {
        throw new Error('Supabase non ha restituito una sessione valida dal link email.');
      }
      openAuthenticationModal();
      saveCloudSession(verified);
      history.replaceState(null, '', location.pathname);
      stored = localStorage.getItem(CLOUD_SESSION_KEY);
    } catch (error) {
      history.replaceState(null, '', location.pathname);
      openAuthenticationModal();
      setAccountStatus(error.message || 'Il link di conferma non è valido o è scaduto. Richiedi un nuovo link.', true);
      return;
    }
  } else if (returnedAccessToken || returnedRefreshToken) {
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    openAuthenticationModal();
    setAccountStatus('Il link di conferma è incompleto o scaduto. Richiedi un nuovo link o accedi con email e password.', true);
    return;
  } else if (returnedParams.has('code')) {
    history.replaceState(null, '', `${location.pathname}`);
    openAuthenticationModal();
    setAccountStatus('Il link di conferma usa un codice non supportato. Verifica il tipo di link email configurato in Supabase oppure accedi con email e password.', true);
    return;
  }
  if (!stored) {
    isAuthenticated = false;
    updateAccountControls();
    setAccountStatus('I tuoi dati vengono salvati su questo dispositivo. Collega un account quando vuoi sincronizzarli.');
    return;
  }
  let cachedUserId = null;
  let hasLoadedCachedArchive = false;
  try {
    const session = JSON.parse(stored);
    if (!session.access_token || !session.refresh_token) {
      throw new Error('Sessione locale non valida.');
    }
    cloudSession = session;
    cachedUserId = session.user && session.user.id;
    if (typeof cachedUserId === 'string' && cachedUserId) {
      activeOwnerId = cachedUserId;
      events = await readAllEvents(cachedUserId);
      purchases = await readAllPurchases(cachedUserId);
      categories = await loadCategoriesForOwner(cachedUserId);
      hasLoadedCachedArchive = true;
      isAuthenticated = true;
      isAppReady = true;
      populateProfileSettings(session.user);
      render();
      updateAccountControls();
    }
    if (isPasswordRecovery) openAuthenticationModal();
    const expiresAt = Number(session.expires_at);
    if (!Number.isFinite(expiresAt) || expiresAt < Math.floor(Date.now() / 1000) + 60) {
      saveCloudSession(await refreshCloudSession(session.refresh_token));
    }
    let user = await fetch(`${supabaseConfig.url.replace(/\/$/, '')}/auth/v1/user`, {
      headers: {
        apikey: supabaseConfig.anonKey,
        Authorization: `Bearer ${cloudSession.access_token}`
      }
    });
    if (user.status === 401) {
      // Un token scaduto o revocato viene rinnovato una volta anche se expires_at sembrava valido.
      saveCloudSession(await refreshCloudSession(cloudSession.refresh_token));
      user = await fetch(`${supabaseConfig.url.replace(/\/$/, '')}/auth/v1/user`, {
        headers: {
          apikey: supabaseConfig.anonKey,
          Authorization: `******`
        }
      });
    }
    if (!user.ok) throw new Error(`Verifica dell’account non riuscita (HTTP ${user.status}).`);
    cloudSession.user = await user.json();
    saveCloudSession(cloudSession);
    cachedUserId = cloudSession.user.id;
    await syncCloudEvents();
    try {
      if (await completePendingProfileSetup(cloudSession.user)) {
        setAccountStatus('Accesso ripristinato. Foto profilo applicata.');
      }
    } catch (error) {
      console.error(error);
      setAccountStatus(`Account sincronizzato, ma la foto profilo in attesa non è stata caricata: ${error.message || 'riprova dalle impostazioni account.'}`, true);
    }
    if (isPasswordRecovery) {
      isAuthenticated = false;
      updateAccountControls();
      openAuthenticationModal();
      setAccountStatus('Imposta una nuova password per il tuo account.');
    }
  } catch (error) {
    console.error(error);
    if (error.authSessionCleared) {
      await activateGuestArchive();
      setAccountStatus('La sessione cloud non è più valida. Puoi continuare con i dati locali o accedere di nuovo.', true);
      return;
    }
    if (hasLoadedCachedArchive && cachedUserId && activeOwnerId === cachedUserId) {
      isAuthenticated = true;
      isAppReady = true;
      updateAccountControls();
      setAccountStatus(`Connessione non disponibile. Stai usando la copia locale dell’account.${error.message ? ` ${error.message}` : ''}`, false, false, true);
      return;
    }
    await activateGuestArchive();
    updateAccountControls();
    setAccountStatus(`Accesso cloud non disponibile. I dati locali restano utilizzabili.${error.message ? ` ${error.message}` : ''}`, false, false, true);
  }
}

async function refreshWhenReturningToApp() {
  if (!cloudConfigured) return;
  if (!isAuthenticated) {
    if (localStorage.getItem(CLOUD_SESSION_KEY)) await restoreCloudSession();
    return;
  }
  try {
    await syncCloudEvents();
  } catch (error) {
    console.error(error);
    if (error.authSessionCleared) return;
    setAccountStatus(`Sincronizzazione non riuscita: ${error.message || 'verifica la connessione.'}`, true);
  }
}

function setupAuthenticationEvents() {
  elements.openAuthModal.addEventListener('click', openAuthenticationModal);
  elements.closeAuthModal.addEventListener('click', closeAuthenticationModal);
  elements.authModal.addEventListener('click', event => {
    if (event.target === elements.authModal) closeAuthenticationModal();
  });
  window.addEventListener('storage', event => {
    if (event.key === CLOUD_SESSION_KEY) {
      if (!event.newValue && isAuthenticated) {
        cloudSession = null;
        void activateGuestArchive().then(() => {
          setAccountStatus('Sessione terminata in un’altra scheda. Lo storico online resta nel tuo account.');
        }).catch(error => {
          console.error(error);
          setAccountStatus(`Sessione terminata in un’altra scheda; archivio locale non caricato: ${error.message || 'errore sconosciuto'}`, true);
        });
      } else if (event.newValue) {
        let nextSession = null;
        let nextUserId = null;
        try {
          nextSession = JSON.parse(event.newValue);
          nextUserId = nextSession.user && nextSession.user.id;
        } catch (error) {
          console.warn('La sessione aggiornata nell’altra scheda non è leggibile.', error);
        }
        const accountChanged = nextUserId !== activeOwnerId;
        if (accountChanged) cloudSession = null;
        else cloudSession = nextSession;
        void (async () => {
          if (accountChanged) await activateGuestArchive();
          if (accountChanged || !isAuthenticated) await restoreCloudSession();
        })().catch(error => {
          console.error(error);
          setAccountStatus(`Impossibile aggiornare la sessione dell’altra scheda: ${error.message || 'errore sconosciuto'}`, true);
        });
      }
    }
  });
  window.addEventListener('online', () => requestCloudSync());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refreshWhenReturningToApp();
  });
}

function openDatabase() {
  if (database) return Promise.resolve(database);
  // Riusa l'apertura già in corso se più operazioni IndexedDB partono contemporaneamente.
  if (databaseOpening) return databaseOpening;

  databaseOpening = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('Questo browser non supporta l’archivio locale richiesto.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const legacyOwnerId = localStorage.getItem(LAST_SYNC_USER_KEY) || GUEST_OWNER_ID;
      const migrateStore = (storeName, hasTimestamp) => {
        if (!db.objectStoreNames.contains(storeName)) {
          const store = db.createObjectStore(storeName, { keyPath: 'localKey' });
          store.createIndex('ownerId', 'ownerId', { unique: false });
          if (hasTimestamp) store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
          return;
        }
        const oldStore = request.transaction.objectStore(storeName);
        if (oldStore.keyPath === 'localKey') return;
        const read = oldStore.getAll();
        read.onsuccess = () => {
          const records = read.result || [];
          db.deleteObjectStore(storeName);
          const store = db.createObjectStore(storeName, { keyPath: 'localKey' });
          store.createIndex('ownerId', 'ownerId', { unique: false });
          if (hasTimestamp) store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
          for (const record of records) store.put(normalizeStoredRecord(record, legacyOwnerId));
        };
      };
      migrateStore(STORE_NAME, true);
      migrateStore(PURCHASE_STORE_NAME, true);
      migrateStore(CATEGORY_STORE_NAME, false);
      if (!db.objectStoreNames.contains(PROFILE_DRAFT_STORE_NAME)) {
        db.createObjectStore(PROFILE_DRAFT_STORE_NAME, { keyPath: 'email' });
      }
      if (!db.objectStoreNames.contains(SYNC_STORE_NAME)) db.createObjectStore(SYNC_STORE_NAME, { keyPath: 'ownerId' });
    };
    request.onsuccess = () => {
      const openedDatabase = request.result;
      openedDatabase.onversionchange = () => {
        if (database === openedDatabase) database = null;
        openedDatabase.close();
      };
      openedDatabase.onclose = () => {
        if (database === openedDatabase) database = null;
      };
      database = openedDatabase;
      resolve(openedDatabase);
    };
    request.onerror = () => reject(request.error || new Error('Impossibile aprire l’archivio locale.'));
    request.onblocked = () => reject(new Error('Chiudi eventuali altre schede di SmokeLOG e riprova.'));
  });
  databaseOpening.then(
    () => { databaseOpening = null; },
    () => { databaseOpening = null; }
  );
  return databaseOpening;
}

async function createDatabaseTransaction(mode, storeName = STORE_NAME) {
  // Alcuni browser chiudono la connessione inattiva: riaprila e riprova una sola volta.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const currentDatabase = await openDatabase();
    try {
      return currentDatabase.transaction(storeName, mode);
    } catch (error) {
      if (error.name !== 'InvalidStateError' || attempt > 0) throw error;
      if (database === currentDatabase) database = null;
    }
  }
  throw new Error('Impossibile riaprire l’archivio locale.');
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Operazione non riuscita.'));
    transaction.onabort = () => reject(transaction.error || new Error('Operazione annullata.'));
  });
}

async function readAllEvents(ownerId = activeOwnerId, includeDeleted = false) {
  return readOwnerRecords(STORE_NAME, ownerId, includeDeleted);
}

async function readOwnerRecords(storeName, ownerId, includeDeleted = false) {
  const tx = await createDatabaseTransaction('readonly', storeName);
  const done = transactionDone(tx);
  const request = tx.objectStore(storeName).index('ownerId').getAll(ownerId);
  const result = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error || new Error('Impossibile leggere lo storico.'));
  });
  await done;
  return result.filter(record => record.ownerId === ownerId && (includeDeleted || !record.deletedAt))
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

function normalizeStoredRecord(record, ownerId = activeOwnerId) {
  const recordOwner = ownerId;
  return {
    ...record,
    ownerId: recordOwner,
    localKey: `${recordOwner}:${record.id}`,
    updatedAt: record.updatedAt || record.updated_at || record.timestamp,
    deletedAt: record.deletedAt || record.deleted_at || null
  };
}

async function writeStoredRecord(storeName, record, ownerId, add = false) {
  const tx = await createDatabaseTransaction('readwrite', storeName);
  const store = tx.objectStore(storeName);
  store[add ? 'add' : 'put'](normalizeStoredRecord(record, ownerId));
  await transactionDone(tx);
}

async function replaceOwnerRecords(storeName, records, ownerId) {
  const tx = await createDatabaseTransaction('readwrite', storeName);
  const store = tx.objectStore(storeName);
  const request = store.getAll();
  request.onsuccess = () => {
    for (const record of request.result || []) {
      if (record.ownerId === ownerId) store.delete(record.localKey);
    }
    for (const record of records) store.put(normalizeStoredRecord(record, ownerId));
  };
  await transactionDone(tx);
}

function recordsNeedingUpload(records, remoteRecords) {
  const remoteById = new Map(remoteRecords.map(record => [record.id, record]));
  return records.filter(record => {
    const remote = remoteById.get(record.id);
    if (!remote) return true;
    return Date.parse(record.updatedAt || record.timestamp) > Date.parse(remote.updatedAt || remote.timestamp);
  });
}

function mergeArchiveSnapshot(incoming, current, snapshot) {
  const result = new Map(current.map(record => [record.id, record]));
  const expected = snapshot && new Map(snapshot.map(record => [record.id, record]));
  for (const record of incoming) {
    const local = result.get(record.id);
    // Compare inside the write transaction: a second tab can write after the
    // network snapshot without incrementing this tab's mutation counter.
    if (expected && local && JSON.stringify(local) !== JSON.stringify(expected.get(record.id))) continue;
    if (!expected && local && Date.parse(local.updatedAt || local.timestamp) >= Date.parse(record.updatedAt || record.timestamp)) continue;
    result.set(record.id, record);
  }
  return [...result.values()];
}

async function commitArchive(ownerId, incoming, snapshots = null, guestSnapshots = null, cloudSnapshot = null) {
  const stores = [STORE_NAME, PURCHASE_STORE_NAME, CATEGORY_STORE_NAME];
  const tx = await createDatabaseTransaction('readwrite', cloudSnapshot ? [...stores, SYNC_STORE_NAME] : stores);
  const done = transactionDone(tx);
  if (cloudSnapshot) tx.objectStore(SYNC_STORE_NAME).put(cloudSnapshot);
  const committed = [];
  stores.forEach((name, index) => {
    const store = tx.objectStore(name);
    const request = store.index('ownerId').getAll(ownerId);
    request.onsuccess = () => {
      committed[index] = mergeArchiveSnapshot(incoming[index], request.result, snapshots && snapshots[index])
        .map(record => normalizeStoredRecord(record, ownerId));
      const stored = new Map(request.result.map(record => [record.id, record]));
      for (const record of committed[index]) {
        const normalized = normalizeStoredRecord(record, ownerId);
        if (JSON.stringify(normalized) !== JSON.stringify(stored.get(record.id))) store.put(normalized);
      }
    };
    // Migration and cleanup share the transaction: neither half can commit alone.
    if (guestSnapshots && ownerId !== GUEST_OWNER_ID) {
      for (const snapshot of guestSnapshots[index]) {
        const guest = store.get(`${GUEST_OWNER_ID}:${snapshot.id}`);
        guest.onsuccess = () => {
          if (JSON.stringify(guest.result) === JSON.stringify(snapshot)) store.delete(`${GUEST_OWNER_ID}:${snapshot.id}`);
        };
      }
    }
  });
  await done;
  return committed;
}

async function clearOwnerRecords(storeName, ownerId) {
  const tx = await createDatabaseTransaction('readwrite', storeName);
  const store = tx.objectStore(storeName);
  const request = store.getAll();
  request.onsuccess = () => {
    for (const record of request.result || []) {
      if (record.ownerId === ownerId) store.delete(record.localKey);
    }
  };
  await transactionDone(tx);
}

async function clearOwnerRecordsBySnapshot(storeName, ownerId, records) {
  if (!records.length) return;
  const expected = new Map(records.map(record => [record.id, record.updatedAt || record.timestamp]));
  const tx = await createDatabaseTransaction('readwrite', storeName);
  const store = tx.objectStore(storeName);
  const request = store.getAll();
  request.onsuccess = () => {
    for (const record of request.result || []) {
      const expectedUpdatedAt = expected.get(record.id);
      const actualUpdatedAt = record.updatedAt || record.timestamp;
      if (record.ownerId === ownerId && expectedUpdatedAt && actualUpdatedAt === expectedUpdatedAt) {
        store.delete(record.localKey);
      }
    }
  };
  await transactionDone(tx);
}

async function persistEvent(event, ownerId = activeOwnerId) {
  await writeStoredRecord(STORE_NAME, event, ownerId, true);
}

async function updateStoredEvent(event, ownerId = event.ownerId || activeOwnerId) {
  await writeStoredRecord(STORE_NAME, event, ownerId);
}

async function replaceAllEvents(importedEvents, ownerId = activeOwnerId) {
  await replaceOwnerRecords(STORE_NAME, importedEvents, ownerId);
}

async function clearAllEvents(ownerId = activeOwnerId) {
  await clearOwnerRecords(STORE_NAME, ownerId);
}

async function readAllPurchases(ownerId = activeOwnerId, includeDeleted = false) {
  return readOwnerRecords(PURCHASE_STORE_NAME, ownerId, includeDeleted);
}

async function persistPurchase(purchase, ownerId = activeOwnerId) {
  await writeStoredRecord(PURCHASE_STORE_NAME, purchase, ownerId, true);
}

async function updateStoredPurchase(purchase, ownerId = purchase.ownerId || activeOwnerId) {
  await writeStoredRecord(PURCHASE_STORE_NAME, purchase, ownerId);
}

async function replaceAllPurchases(importedPurchases, ownerId = activeOwnerId) {
  await replaceOwnerRecords(PURCHASE_STORE_NAME, importedPurchases, ownerId);
}

async function clearAllPurchases(ownerId = activeOwnerId) {
  await clearOwnerRecords(PURCHASE_STORE_NAME, ownerId);
}

async function readAllCategories(ownerId = activeOwnerId, includeDeleted = false) {
  return readOwnerRecords(CATEGORY_STORE_NAME, ownerId, includeDeleted);
}

async function persistCategory(category, ownerId = activeOwnerId) {
  await writeStoredRecord(CATEGORY_STORE_NAME, category, ownerId);
}

async function replaceAllCategories(records, ownerId = activeOwnerId) {
  await replaceOwnerRecords(CATEGORY_STORE_NAME, records, ownerId);
}

async function clearAllCategories(ownerId = activeOwnerId) {
  await clearOwnerRecords(CATEGORY_STORE_NAME, ownerId);
}

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

function createTimestampEditButton(kind, record, label) {
  const button = document.createElement('button');
  button.className = 'edit-timestamp';
  button.type = 'button';
  button.textContent = 'Data/ora';
  button.setAttribute('aria-label', `Modifica data e ora: ${label}, ${formatDateTime(record.timestamp)}`);
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
    : 'Puoi modificare data e ora o rimuovere un’attività.';
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
    title.textContent = label;
    const date = document.createElement('p');
    date.className = 'history-item-date';
    date.textContent = formatDateTime(record.timestamp);
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
  elements.weeklyDailySpend.textContent = `${formatCurrency(Math.round(currentSpend / 7))} al giorno`;
  if (previousEvents.length === 0) {
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

let goalsFormOwner = null;
let goalsCategorySignature = '';
const GOALS_KEY = 'smokelog-goals-v1:';

function readGoals() {
  try {
    return SmokeLogInsights.validateGoals(JSON.parse(localStorage.getItem(GOALS_KEY + activeOwnerId) || '{}'));
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
  const data = SmokeLogInsights.calculate(events, purchases, now, goals.category);
  const selectedLabel = goals.category === 'all' ? 'tutte le categorie' : eventLabel(goals.category);
  node('insight-period').textContent = `${formatDateShort(data.from)} – ${formatDateShort(data.to)} · ${selectedLabel}`;
  node('insight-month-spend').textContent = formatCurrency(data.monthSpend);
  node('insight-daily-spend').textContent = formatCurrency(Math.round(data.dailySpend));
  const delta = (value, current, previous) => previous === 0 ? (current === 0 ? 'Nessun dato' : 'Primo confronto') : `${value > 0 ? '+' : ''}${value}%`;
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
    ? `Fasce più attive: ${data.peakTimes.map(index => hours[index]).join(', ')}. Giorni più attivi: ${data.peakDays.map(index => weekdays[index]).join(', ')}.`
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

function renderSavings(data = SmokeLogInsights.calculate(events, purchases)) {
  const reduction = Number(document.getElementById('savings-reduction').value);
  const estimate = SmokeLogInsights.savings(data.last28Spend, reduction);
  document.getElementById('savings-percent').textContent = `${reduction}%`;
  document.getElementById('savings-month').textContent = data.purchaseCount ? formatCurrency(estimate.monthly) : '—';
  document.getElementById('savings-year').textContent = data.purchaseCount ? formatCurrency(estimate.yearly) : '—';
  document.getElementById('savings-context').textContent = data.purchaseCount
    ? `Base di calcolo: ${formatCurrency(data.last28Spend)} in ${data.purchaseCount} acquisti, su 28 giorni. Comprende tutte le categorie di spesa.`
    : 'Servono acquisti registrati nei giorni precedenti per stimare il risparmio. Gli acquisti di oggi entreranno nel calcolo domani.';
}

function setupGoals() {
  document.getElementById('savings-reduction').addEventListener('input', () => renderSavings());
  document.getElementById('savings-reduction').addEventListener('change', () => {
    try {
      localStorage.setItem(GOALS_KEY + activeOwnerId, JSON.stringify({ ...readGoals(), reduction: Number(document.getElementById('savings-reduction').value) }));
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
      localStorage.setItem(GOALS_KEY + activeOwnerId, JSON.stringify(goals));
      renderInsights();
      document.getElementById('goals-status').textContent = 'Obiettivi salvati su questo dispositivo.';
    } catch (error) { document.getElementById('goals-status').textContent = error.message || 'Impossibile salvare gli obiettivi.'; }
  });
  document.getElementById('reset-goals').addEventListener('click', () => {
    try {
      localStorage.removeItem(GOALS_KEY + activeOwnerId);
      goalsFormOwner = null;
      renderInsights();
      document.getElementById('goals-status').textContent = 'Obiettivi rimossi.';
    } catch (error) { showToast('Impossibile rimuovere gli obiettivi.', 'error'); }
  });
}

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
  activeTimestampEdit = { kind, id: record.id, categoryDetails };
  elements.timestampDialogTitle.textContent = labels[record.type] || 'Registrazione';
  elements.timestampDialogEyebrow.textContent = kind === 'event' ? 'MODIFICA REGISTRAZIONE' : 'MODIFICA ACQUISTO';
  const localValue = toDateTimeLocalValue(record.timestamp);
  elements.timestampDate.value = localValue.slice(0, 10);
  elements.timestampTime.value = localValue.slice(11, 16);
  elements.timestampFormError.hidden = true;
  elements.timestampSave.disabled = false;
  elements.timestampDialog.showModal();
  window.requestAnimationFrame(() => elements.timestampDate.focus());
}

async function saveTimestampEdit() {
  if (!activeTimestampEdit) return;
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
  if (!Number.isFinite(date.getTime()) || date.getFullYear() !== year
    || date.getMonth() !== month - 1 || date.getDate() !== day
    || date.getHours() !== hour || date.getMinutes() !== minute) {
    elements.timestampFormError.textContent = 'La data e l’orario inseriti non sono validi.';
    elements.timestampFormError.hidden = false;
    return;
  }

  const { kind, id, categoryDetails } = activeTimestampEdit;
  const records = kind === 'event' ? events : purchases;
  const currentRecord = records.find(record => record.id === id);
  if (!currentRecord) {
    elements.timestampFormError.textContent = 'Questa voce non è più presente nello storico. Chiudi e aggiorna la pagina.';
    elements.timestampFormError.hidden = false;
    return;
  }

  const updatedRecord = {
    ...currentRecord,
    timestamp: date.toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null
  };
  elements.timestampSave.disabled = true;
  elements.timestampFormError.hidden = true;
  try {
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
    showToast('Data e ora aggiornate.');
    requestCloudSync();
  } catch (error) {
    console.error(error);
    elements.timestampSave.disabled = false;
    const detail = error instanceof Error && error.message ? ` ${error.message}` : '';
    elements.timestampFormError.textContent = `Non è stato possibile aggiornare data e ora sul dispositivo.${detail}`;
    elements.timestampFormError.hidden = false;
  }
}

function showToast(message, type = 'success') {
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

async function handleAddEvent(type) {
  const category = categories.find(item => item.id === type && item.isActive);
  if (!category) {
    showToast('Questa categoria non è disponibile. Aggiorna lo storico e riprova.', 'error');
    return;
  }
  try {
    const timestamp = new Date().toISOString();
    const event = { id: makeId(), type, timestamp, updatedAt: timestamp, deletedAt: null };
    await persistEvent(event);
    markLocalMutation();
    events.push(event);
    events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    render();
    showToast(`${eventLabel(type)} registrata.`);
    requestCloudSync();
  } catch (error) {
    console.error(error);
    const detail = error instanceof Error && error.message ? ` ${error.message}` : '';
    showToast(`Registrazione non salvata sul dispositivo.${detail}`, 'error');
  }
}

function openPurchaseDialog() {
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
        ? { type, amountCents }
        : null);
    }, { once: true });
  });
}

async function handleAddPurchase() {
  try {
    const selection = await openPurchaseDialog();
    if (selection === null) return;
    const { type, amountCents } = selection;
    const timestamp = new Date().toISOString();
    const purchase = { id: makeId(), type, amountCents, timestamp, updatedAt: timestamp, deletedAt: null };
    await persistPurchase(purchase);
    markLocalMutation();
    purchases.push(purchase);
    purchases.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    render();
    showToast(`${PURCHASE_LABELS[type]} registrato: ${formatCurrency(amountCents)}.`);
    requestCloudSync();
  } catch (error) {
    console.error(error);
    const detail = error instanceof Error && error.message ? ` ${error.message}` : '';
    showToast(`Spesa non salvata sul dispositivo.${detail}`, 'error');
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
  try {
    const deletedAt = new Date().toISOString();
    await updateStoredPurchase({ ...purchase, updatedAt: deletedAt, deletedAt });
    markLocalMutation();
    purchases = purchases.filter(item => item.id !== purchase.id);
    render();
    resumeCategoryDetails(categoryDetails);
    showToast('Acquisto eliminato.');
    requestCloudSync();
  } catch (error) {
    console.error(error);
    resumeCategoryDetails(categoryDetails);
    showToast('Non è stato possibile eliminare l’acquisto.', 'error');
  }
}

async function handleDeleteEvent(event) {
  const typeLabel = eventLabel(event.type);
  const categoryDetails = suspendCategoryDetails();
  const approved = await openActionDialog({
    title: 'Sicuro che non l’hai fumata?',
    message: `${typeLabel} · ${formatDateTime(event.timestamp)}. La registrazione verrà rimossa dallo storico e sincronizzata quando possibile.`,
    confirmLabel: 'Sì, elimina',
    danger: true
  });
  if (!approved) {
    resumeCategoryDetails(categoryDetails);
    return;
  }
  try {
    const deletedAt = new Date().toISOString();
    await updateStoredEvent({ ...event, updatedAt: deletedAt, deletedAt });
    markLocalMutation();
    events = events.filter(item => item.id !== event.id);
    render();
    resumeCategoryDetails(categoryDetails);
    showToast('Registrazione eliminata.');
    requestCloudSync();
  } catch (error) {
    console.error(error);
    resumeCategoryDetails(categoryDetails);
    showToast('Non è stato possibile eliminare la registrazione.', 'error');
  }
}

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function exportJson() {
  const backup = {
    app: 'SmokeLog',
    schemaVersion: 3,
    exportedAt: new Date().toISOString(),
    events: [...events].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)),
    purchases: [...purchases].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)),
    categories: categories.map(({ id, name, color, position, isActive, updatedAt }) => ({
      id, name, color, position, isActive, updatedAt
    }))
  };
  downloadFile(`smokelog-backup-${localDateKey(new Date())}.json`, JSON.stringify(backup, null, 2), 'application/json;charset=utf-8');
  showToast('Backup JSON preparato. Salvalo in un luogo sicuro.');
}

function csvEscape(value) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function exportCsv() {
  const rows = [['id', 'tipo', 'importo_eur', 'data_ora_iso', 'data_locale', 'ora_locale']];
  const sorted = [...events].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  for (const event of sorted) {
    const date = new Date(event.timestamp);
    rows.push([
      event.id,
      eventLabel(event.type),
      '',
      event.timestamp,
      date.toLocaleDateString('it-IT'),
      date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    ]);
  }
  const sortedPurchases = [...purchases].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  for (const purchase of sortedPurchases) {
    const date = new Date(purchase.timestamp);
    rows.push([
      purchase.id,
      PURCHASE_LABELS[purchase.type],
      (purchase.amountCents / 100).toFixed(2),
      purchase.timestamp,
      date.toLocaleDateString('it-IT'),
      date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    ]);
  }
  const csv = '\uFEFF' + rows.map(row => row.map(csvEscape).join(';')).join('\r\n');
  downloadFile(`smokelog-storico-${localDateKey(new Date())}.csv`, csv, 'text/csv;charset=utf-8');
  showToast('CSV preparato per il salvataggio o l’apertura in un foglio di calcolo.');
}

function validateBackup(parsed) {
  if (!parsed || parsed.app !== 'SmokeLog' || ![1, 2, 3].includes(parsed.schemaVersion) || !Array.isArray(parsed.events)
    || (parsed.schemaVersion >= 2 && !Array.isArray(parsed.purchases))
    || (parsed.schemaVersion === 3 && !Array.isArray(parsed.categories))) {
    throw new Error('Il file non sembra un backup SmokeLOG valido.');
  }
  const exportedAt = typeof parsed.exportedAt === 'string' && Number.isFinite(Date.parse(parsed.exportedAt))
    ? new Date(parsed.exportedAt).toISOString()
    : null;
  const normalizeBackupUpdatedAt = (value, fallback) => {
    if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
    if (typeof fallback === 'string' && Number.isFinite(Date.parse(fallback))) return new Date(fallback).toISOString();
    return exportedAt || new Date(0).toISOString();
  };
  const importedCategories = [];
  const importedCategoryIds = new Set();
  if (parsed.schemaVersion === 3) {
    const importedNames = new Set();
    for (const item of parsed.categories) {
      const normalizedName = item && typeof item.name === 'string' ? item.name.trim() : '';
      if (!item || typeof item.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/i.test(item.id)
        || !normalizedName || normalizedName.length > 28
        || importedCategoryIds.has(item.id)
        || importedNames.has(normalizedName.toLocaleLowerCase('it-IT'))
        || !Object.hasOwn(CATEGORY_COLORS, item.color)
        || !Number.isInteger(item.position) || item.position < 0
        || typeof item.isActive !== 'boolean'
        || (item.updatedAt !== undefined && item.updatedAt !== null
          && (typeof item.updatedAt !== 'string' || !Number.isFinite(Date.parse(item.updatedAt))))) {
        throw new Error('Il backup contiene una categoria non valida. Nessun dato è stato modificato.');
      }
      importedCategoryIds.add(item.id);
      importedNames.add(normalizedName.toLocaleLowerCase('it-IT'));
      importedCategories.push({
        id: item.id,
        name: normalizedName,
        color: item.color,
        position: item.position,
        isActive: item.isActive,
        updatedAt: normalizeBackupUpdatedAt(item.updatedAt, exportedAt),
        deletedAt: null,
        pendingSync: false
      });
    }
  }
  const seen = new Set();
  const validated = [];
  const allowedTypes = new Set([
    ...Object.keys(EVENT_LABELS),
    ...importedCategoryIds
  ]);
  // Convalida l'intero file prima di modificare l'archivio corrente.
  for (const item of parsed.events) {
    if (!item || typeof item.id !== 'string' || !allowedTypes.has(item.type) || typeof item.timestamp !== 'string' || !Number.isFinite(Date.parse(item.timestamp))
      || (item.updatedAt !== undefined && item.updatedAt !== null
        && (typeof item.updatedAt !== 'string' || !Number.isFinite(Date.parse(item.updatedAt))))) {
      throw new Error('Il backup contiene una registrazione non valida. Nessun dato è stato modificato.');
    }
    let id = item.id;
    if (seen.has(id)) id = makeId();
    seen.add(id);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : makeId();
    const timestamp = new Date(item.timestamp).toISOString();
    validated.push({
      id: uuid,
      type: item.type,
      timestamp,
      updatedAt: normalizeBackupUpdatedAt(item.updatedAt, timestamp),
      deletedAt: null
    });
  }
  const seenPurchaseIds = new Set();
  const validatedPurchases = [];
  for (const item of parsed.purchases || []) {
    const amount = Number(item && item.amountCents);
    if (!item || typeof item.id !== 'string' || !Object.hasOwn(PURCHASE_LABELS, item.type)
      || !Number.isSafeInteger(amount) || amount < 1 || amount > 9999999999
      || typeof item.timestamp !== 'string' || !Number.isFinite(Date.parse(item.timestamp))
      || (item.updatedAt !== undefined && item.updatedAt !== null
        && (typeof item.updatedAt !== 'string' || !Number.isFinite(Date.parse(item.updatedAt))))) {
      throw new Error('Il backup contiene un acquisto non valido. Nessun dato è stato modificato.');
    }
    let id = item.id;
    if (seenPurchaseIds.has(id)) id = makeId();
    seenPurchaseIds.add(id);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : makeId();
    const timestamp = new Date(item.timestamp).toISOString();
    validatedPurchases.push({
      id: uuid,
      type: item.type,
      amountCents: amount,
      timestamp,
      updatedAt: normalizeBackupUpdatedAt(item.updatedAt, timestamp),
      deletedAt: null
    });
  }
  return { events: validated, purchases: validatedPurchases, categories: importedCategories };
}

async function importJsonFile(file) {
  if (!file) return;
  try {
    if (file.size > MAX_BACKUP_FILE_SIZE) {
      throw new Error('Il backup è troppo grande. Seleziona un file più piccolo di 10 MB.');
    }
    const raw = await file.text();
    const parsed = JSON.parse(raw);
    const validated = validateBackup(parsed);
    const approved = await openActionDialog({
      title: 'Importare il backup?',
      message: `Il backup contiene ${validated.events.length} registrazioni, ${validated.purchases.length} acquisti e ${validated.categories.length} categorie. I dati saranno uniti a quelli presenti, senza eliminare voci più recenti.`,
      confirmLabel: 'Importa backup',
    });
    if (!approved) return;
    const [existingEvents, existingPurchases, existingCategories] = await Promise.all([
      readAllEvents(activeOwnerId, true),
      readAllPurchases(activeOwnerId, true),
      readAllCategories(activeOwnerId, true)
    ]);
    for (const importedCategory of validated.categories) {
      const duplicateName = existingCategories.some(category => category.id !== importedCategory.id
        && category.name.toLocaleLowerCase('it-IT') === importedCategory.name.toLocaleLowerCase('it-IT'));
      if (duplicateName) {
        throw new Error(`Il backup contiene una categoria chiamata “${importedCategory.name}”, già presente con un ID diverso. Rinomina una delle categorie e riprova.`);
      }
    }
    const mergedEvents = mergeById(existingEvents, validated.events);
    const mergedPurchases = mergeById(existingPurchases, validated.purchases);
    const mergedCategories = mergeById(existingCategories, validated.categories);
    const committed = await commitArchive(activeOwnerId, [mergedEvents, mergedPurchases, mergedCategories]);
    // A fallback from an earlier edit must not undo a genuinely newer import.
    // Keep newer preferences, including edits made while the import was saving.
    try {
      const preferences = readCategoryPreferences();
      const ownerPreferences = preferences[activeOwnerId] || {};
      for (const category of committed[2]) {
        const preference = ownerPreferences[category.id];
        if (!category.pendingSync && preference && Date.parse(preference.updatedAt) < Date.parse(category.updatedAt)) delete ownerPreferences[category.id];
      }
      preferences[activeOwnerId] = ownerPreferences;
      localStorage.setItem(CATEGORY_PREFERENCES_KEY, JSON.stringify(preferences));
    } catch (error) { console.warn('Preferenze del backup non aggiornate.', error); }
    markLocalMutation();
    events = await readAllEvents();
    purchases = await readAllPurchases();
    categories = await loadCategoriesForOwner(activeOwnerId);
    render();
    requestCloudSync();
    showToast(`Importati ${validated.events.length} consumi e ${validated.purchases.length} acquisti.`);
  } catch (error) {
    console.error(error);
    await openActionDialog({
      title: 'Importazione non riuscita',
      message: error instanceof SyntaxError ? 'Il file selezionato non è un JSON valido.' : (error.message || 'Non è stato possibile importare il backup.'),
      notice: true
    });
  } finally {
    elements.importFile.value = '';
  }
}

async function handleClearData() {
  if (events.length === 0 && purchases.length === 0) {
    showToast('Non ci sono registrazioni o acquisti da eliminare.', 'info');
    return;
  }
  const recordsToDelete = events.length + purchases.length;
  const approved = await openActionDialog({
    title: 'Eliminare tutto lo storico?',
    message: `Stai per eliminare ${events.length} registrazioni e ${purchases.length} acquisti da questo archivio. La cancellazione verrà sincronizzata quando possibile. Esporta prima un backup se vuoi conservarli.`,
    confirmLabel: 'Sì, elimina tutto',
    danger: true
  });
  if (!approved) return;
  try {
    const deletedAt = new Date().toISOString();
    const eventTombstones = await readAllEvents(activeOwnerId, true);
    const purchaseTombstones = await readAllPurchases(activeOwnerId, true);
    const tombstone = record => ({ ...record, deletedAt,
      updatedAt: new Date(Math.max(Date.parse(deletedAt), (Date.parse(record.updatedAt) || 0) + 1)).toISOString() });
    const committed = await commitArchive(activeOwnerId, [eventTombstones.map(tombstone), purchaseTombstones.map(tombstone), []]);
    markLocalMutation();
    events = committed[0].filter(event => !event.deletedAt);
    purchases = committed[1].filter(purchase => !purchase.deletedAt);
    render();
    requestCloudSync();
    showToast(`${recordsToDelete} voci eliminate dall’archivio.`);
  } catch (error) {
    console.error(error);
    showToast('Non è stato possibile eliminare lo storico.', 'error');
  }
}

async function updateStorageStatus() {
  if (!navigator.storage || typeof navigator.storage.persisted !== 'function') {
    elements.storageStatus.textContent = 'Questo browser non permette a SmokeLOG di richiedere la protezione dell’archivio. Conserva periodicamente un backup JSON.';
    return;
  }

  try {
    const isPersistent = await navigator.storage.persisted();
    elements.storageStatus.textContent = isPersistent
      ? 'Protezione attiva: il browser non dovrebbe rimuovere automaticamente questi dati. La cancellazione manuale dei dati del sito può comunque eliminarli.'
      : 'La protezione non è attiva: il browser potrebbe rimuovere i dati in alcune circostanze. Esporta periodicamente un backup JSON.';
  } catch (error) {
    console.error(error);
    elements.storageStatus.textContent = 'Non è stato possibile verificare la protezione dell’archivio. Conserva periodicamente un backup JSON.';
  }
}

async function requestStoragePersistence() {
  if (!navigator.storage || typeof navigator.storage.persist !== 'function') {
    showToast('Questo browser non supporta la protezione dell’archivio.');
    return;
  }

  try {
    const isPersistent = await navigator.storage.persist();
    elements.storageStatus.textContent = isPersistent
      ? 'Protezione attiva: il browser non dovrebbe rimuovere automaticamente questi dati. La cancellazione manuale dei dati del sito può comunque eliminarli.'
      : 'Il browser non ha attivato la protezione. Esporta periodicamente un backup JSON.';
    showToast(isPersistent ? 'Protezione dell’archivio attivata.' : 'Protezione non attivata: crea un backup JSON.');
  } catch (error) {
    console.error(error);
    elements.storageStatus.textContent = 'Non è stato possibile attivare la protezione. Conserva periodicamente un backup JSON.';
    showToast('Richiesta di protezione non riuscita.');
  }
}

function setupEventHandlers() {
  setupGoals();
  document.getElementById('delete-account').addEventListener('click', () => void handleDeleteAccount());
  document.getElementById('record-expense').addEventListener('click', () => void handleAddPurchase());
  elements.accountAccessButton.addEventListener('click', () => {
    if (isAuthenticated) setAppPage('settings');
    else openAuthenticationModal();
  });
  elements.categoryStatsGrid.addEventListener('click', event => {
    const button = event.target.closest('[data-event-type]');
    if (button && elements.categoryStatsGrid.contains(button)) {
      openCategoryDetails('event', button.dataset.eventType);
    }
  });
  elements.categoryForm.addEventListener('submit', event => {
    event.preventDefault();
    void addCategory(elements.categoryName.value).then(added => {
      if (added) elements.categoryForm.reset();
    });
  });
  elements.expenseCategoryGrid.addEventListener('click', event => {
    const card = event.target.closest('[data-purchase-type]');
    if (card && elements.expenseCategoryGrid.contains(card)) {
      openCategoryDetails('purchase', card.dataset.purchaseType);
    }
  });
  elements.closeCategoryDetails.addEventListener('click', () => elements.categoryDetailsDialog.close());
  elements.categoryDetailsDialog.addEventListener('close', () => {
    activeCategoryDetails = null;
  });
  elements.categoryDetailsDialog.addEventListener('click', event => {
    if (event.target === elements.categoryDetailsDialog) elements.categoryDetailsDialog.close();
  });
  elements.timestampForm.addEventListener('submit', event => {
    event.preventDefault();
    void saveTimestampEdit();
  });
  elements.timestampCancel.addEventListener('click', () => elements.timestampDialog.close());
  elements.timestampDialog.addEventListener('close', () => {
    if (!activeTimestampEdit) return;
    const { categoryDetails } = activeTimestampEdit;
    activeTimestampEdit = null;
    elements.timestampSave.disabled = false;
    resumeCategoryDetails(categoryDetails);
  });
  elements.timestampDialog.addEventListener('click', event => {
    if (event.target === elements.timestampDialog) elements.timestampDialog.close();
  });
  elements.purchaseForm.addEventListener('submit', event => {
    event.preventDefault();
    const type = elements.purchaseType.value;
    const amount = elements.purchaseAmount.valueAsNumber;
    const amountCents = Math.round(amount * 100);
    if (!Object.hasOwn(PURCHASE_LABELS, type)) {
      elements.purchaseFormError.textContent = 'Scegli una categoria di spesa.';
      elements.purchaseFormError.hidden = false;
      elements.purchaseType.reportValidity();
      return;
    }
    if (!Number.isFinite(amount) || !elements.purchaseAmount.checkValidity()
      || !Number.isSafeInteger(amountCents) || amountCents < 1 || amountCents > 9999999999) {
      elements.purchaseFormError.textContent = 'Inserisci un importo valido, maggiore di zero e con al massimo due decimali.';
      elements.purchaseFormError.hidden = false;
      elements.purchaseAmount.reportValidity();
      return;
    }
    elements.purchaseFormError.hidden = true;
    elements.purchaseDialog.returnValue = `${type}:${amountCents}`;
    elements.purchaseDialog.close();
  });
  elements.purchaseCancel.addEventListener('click', () => elements.purchaseDialog.close());
  elements.purchaseDialog.addEventListener('click', event => {
    if (event.target === elements.purchaseDialog) elements.purchaseDialog.close();
  });
  document.querySelectorAll('[data-range]').forEach(button => {
    button.addEventListener('click', () => {
      if (!['day', 'week', 'month', 'year'].includes(button.dataset.range)) return;
      activeRange = button.dataset.range;
      updateRangeButtons();
      saveStatsPreferences();
      render();
    });
  });
  document.querySelectorAll('[data-stats-view]').forEach(button => {
    button.addEventListener('click', () => setStatsView(button.dataset.statsView));
  });
  document.querySelectorAll('[data-page-target]').forEach(button => {
    button.addEventListener('click', () => setAppPage(button.dataset.pageTarget));
  });
  elements.historyKindFilter.addEventListener('change', () => {
    historyKindFilter = elements.historyKindFilter.value;
    historyVisibleCount = HISTORY_PAGE_SIZE;
    renderHistory();
  });
  elements.historyRangeFilter.addEventListener('change', () => {
    historyRangeFilter = elements.historyRangeFilter.value;
    historyVisibleCount = HISTORY_PAGE_SIZE;
    renderHistory();
  });
  elements.historyLoadMore.addEventListener('click', () => {
    historyVisibleCount += HISTORY_PAGE_SIZE;
    renderHistory();
  });
  document.getElementById('export-json').addEventListener('click', exportJson);
  document.getElementById('export-csv').addEventListener('click', exportCsv);
  document.getElementById('import-json').addEventListener('click', () => elements.importFile.click());
  elements.importFile.addEventListener('change', () => importJsonFile(elements.importFile.files && elements.importFile.files[0]));
  document.getElementById('clear-data').addEventListener('click', handleClearData);
  document.getElementById('protect-storage').addEventListener('click', requestStoragePersistence);
  elements.authForm.addEventListener('submit', event => {
    event.preventDefault();
    if (isPasswordRecovery) {
      void handleSaveNewPassword();
    } else if (authMode === 'signup') {
      void handleSignUp();
    } else {
      void handleSignIn();
    }
  });
  elements.signUp.addEventListener('click', () => setAuthMode('signup'));
  elements.switchAuthMode.addEventListener('click', () => setAuthMode('signin'));
  elements.recoverPassword.addEventListener('click', handlePasswordRecovery);
  elements.resendConfirmation.addEventListener('click', handleResendConfirmation);
  elements.signOut.addEventListener('click', handleSignOut);
  const updatePasswordConfirmationValidity = () => {
    const mismatch = elements.confirmPassword.value
      && elements.confirmPassword.value !== elements.accountPassword.value;
    elements.confirmPassword.setCustomValidity(mismatch ? 'Le password non corrispondono.' : '');
  };
  elements.accountPassword.addEventListener('input', updatePasswordConfirmationValidity);
  elements.confirmPassword.addEventListener('input', updatePasswordConfirmationValidity);
  elements.signupNickname.addEventListener('input', () => elements.signupNickname.setCustomValidity(''));
  elements.signupAvatarFile.addEventListener('change', () => {
    const file = elements.signupAvatarFile.files && elements.signupAvatarFile.files[0];
    signupAvatarDraft = file || null;
    if (signupAvatarPreviewUrl) URL.revokeObjectURL(signupAvatarPreviewUrl);
    signupAvatarPreviewUrl = file ? URL.createObjectURL(file) : null;
    if (file) setProfilePreview(elements.signupAvatarPreview, signupAvatarPreviewUrl);
    else elements.signupAvatarPreview.replaceChildren();
  });
  elements.profileForm.addEventListener('submit', event => void saveProfileSettings(event));
  elements.profileNickname.addEventListener('input', () => elements.profileNickname.setCustomValidity(''));
  elements.profileAvatarFile.addEventListener('change', () => {
    const file = elements.profileAvatarFile.files && elements.profileAvatarFile.files[0];
    profileAvatarDraft = file || null;
    removeProfileAvatarOnSave = false;
    elements.removeProfileAvatar.textContent = 'Rimuovi foto';
    const currentProfile = accountProfile(cloudSession && cloudSession.user);
    elements.removeProfileAvatar.hidden = !file && !currentProfile.avatarPath && !currentProfile.avatarUrl;
    if (profileAvatarPreviewUrl) URL.revokeObjectURL(profileAvatarPreviewUrl);
    profileAvatarPreviewUrl = file ? URL.createObjectURL(file) : null;
    if (file) setProfilePreview(elements.profileAvatarPreview, profileAvatarPreviewUrl);
    else {
      const user = cloudSession && cloudSession.user;
      const profile = accountProfile(user);
      const cachedUrl = user && resolvedAvatarCache && resolvedAvatarCache.key === `${user.id}:${profile.avatarPath}`
        ? resolvedAvatarCache.url
        : profile.avatarUrl;
      setProfilePreview(elements.profileAvatarPreview, cachedUrl);
    }
    setProfileFormStatus();
  });
  elements.removeProfileAvatar.addEventListener('click', () => {
    if (removeProfileAvatarOnSave) {
      removeProfileAvatarOnSave = false;
      elements.removeProfileAvatar.textContent = 'Rimuovi foto';
      const user = cloudSession && cloudSession.user;
      const profile = accountProfile(user);
      const cachedUrl = user && resolvedAvatarCache && resolvedAvatarCache.key === `${user.id}:${profile.avatarPath}`
        ? resolvedAvatarCache.url
        : profile.avatarUrl;
      setProfilePreview(elements.profileAvatarPreview, cachedUrl);
      return;
    }
    if (profileAvatarPreviewUrl) URL.revokeObjectURL(profileAvatarPreviewUrl);
    profileAvatarPreviewUrl = null;
    profileAvatarDraft = null;
    elements.profileAvatarFile.value = '';
    removeProfileAvatarOnSave = true;
    elements.removeProfileAvatar.textContent = 'Annulla rimozione';
    setProfilePreview(elements.profileAvatarPreview, null);
    setProfileFormStatus('La foto verrà rimossa dal profilo quando salvi.');
  });
  setupAuthenticationEvents();
}

async function init() {
  // Prepara UI e archivio prima di ripristinare la sessione, che può attivare la sincronizzazione.
  loadStatsPreferences();
  setStatsView(activeStatsView, false);
  updateRangeButtons();
  setupSettingsSectionPreferences();
  setupEventHandlers();
  updateAccountControls();
  try {
    await openDatabase();
    activeOwnerId = GUEST_OWNER_ID;
    events = await readAllEvents(activeOwnerId);
    purchases = await readAllPurchases(activeOwnerId);
    categories = await loadCategoriesForOwner(activeOwnerId);
    isAppReady = true;
    render();
    updateAccountControls();
    await updateStorageStatus();
  } catch (error) {
    console.error(error);
    await openActionDialog({
      title: 'Archivio non disponibile',
      message: `SmokeLOG non riesce ad aprire l’archivio locale. Prova con una versione recente di Safari o di un browser compatibile. Dettaglio: ${error.message || 'errore sconosciuto'}`,
      notice: true
    });
  }

  try {
    if (cloudConfigured) {
      await restoreCloudSession();
    } else {
      setAccountStatus('Archivio locale attivo. Configura Supabase dal README se vuoi sincronizzare i dati tra dispositivi.');
    }
  } finally {
    if (isAppReady) updateAccountControls();
  }

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('./service-worker.js').catch(error => console.warn('Service worker non registrato:', error));
  }
}

document.addEventListener('DOMContentLoaded', init);
