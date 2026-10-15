'use strict';

const DB_NAME = 'smokelog-local-db';
const DB_VERSION = 1;
const STORE_NAME = 'events';
const MAX_RECENT_EVENTS = 10;
const CLOUD_BATCH_SIZE = 500;
const CLOUD_SESSION_KEY = 'smokelog-supabase-session';
const LAST_SYNC_USER_KEY = 'smokelog-last-sync-user';
const EVENT_LABELS = {
  cigarette: 'Sigaretta',
  joint: 'Barnei',
  'half-cigarette': 'Mezza Siga',
  puzzetta: 'Puzzetta',
  puff: 'Cartuccia Puff'
};

let database;
let databaseOpening;
let events = [];
let activeRange = 'day';
let toastTimer;
let cloudSession = null;
let isAuthenticated = false;
let isPasswordRecovery = false;
let authMode = 'signin';
let awaitingEmailConfirmation = false;
let authRequestPending = false;
let authRestorePromise = null;
let cloudSyncPromise = null;

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
  todayCigarettes: document.getElementById('today-cigarettes'),
  todayJoints: document.getElementById('today-joints'),
  todayHalfCigarettes: document.getElementById('today-half-cigarettes'),
  todayPuzzetta: document.getElementById('today-puzzetta'),
  todayPuff: document.getElementById('today-puff'),
  periodLabel: document.getElementById('period-label'),
  periodTotal: document.getElementById('period-total'),
  periodCigarettes: document.getElementById('period-cigarettes'),
  periodJoints: document.getElementById('period-joints'),
  periodHalfCigarettes: document.getElementById('period-half-cigarettes'),
  periodPuzzetta: document.getElementById('period-puzzetta'),
  periodPuff: document.getElementById('period-puff'),
  chartTitle: document.getElementById('chart-title'),
  chartSubtitle: document.getElementById('chart-subtitle'),
  chartTotalPill: document.getElementById('chart-total-pill'),
  chartBars: document.getElementById('chart-bars'),
  historyList: document.getElementById('history-list'),
  historyCount: document.getElementById('history-count'),
  historyFootnote: document.getElementById('history-footnote'),
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
  privacyLabel: document.getElementById('privacy-label'),
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

function updateAccountControls() {
  // Il blocco dell'interfaccia e i controlli dipendono sempre dallo stato auth corrente.
  const signedIn = isAuthenticated;
  const signingUp = authMode === 'signup';
  elements.appFrame.inert = !signedIn;
  elements.appFrame.classList.toggle('is-locked', !signedIn);
  elements.authGate.hidden = signedIn;
  elements.authGateMessage.textContent = cloudConfigured
    ? 'Accedi o crea un account per usare SmokeLog e sincronizzare il tuo storico.'
    : 'La sincronizzazione non è ancora configurata. Completa i passaggi Supabase indicati nel README.';
  elements.openAuthModal.disabled = !cloudConfigured;
  elements.privacyLabel.textContent = !cloudConfigured
    ? 'Solo sul dispositivo'
    : signedIn ? 'Account attivo' : 'Accedi per sincronizzare';
  elements.footerPrivacyLabel.textContent = cloudConfigured
    ? 'Account personale · Nessun analytics'
    : 'Solo sul dispositivo · Nessun analytics';
  elements.signedInControls.hidden = !signedIn;
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
      : 'Lo storico è privato e sincronizzato sul tuo account.';
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
  document.getElementById('add-cigarette').disabled = !signedIn;
  document.getElementById('add-joint').disabled = !signedIn;
  document.getElementById('add-half-cigarette').disabled = !signedIn;
  document.getElementById('add-puzzetta').disabled = !signedIn;
  document.getElementById('add-puff').disabled = !signedIn;
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
    throw new Error((result && (result.message || result.details || result.hint)) || `Operazione cloud non riuscita (HTTP ${response.status}).`);
  }
  return result;
}

async function uploadCloudEvents(source) {
  // Suddivide gli invii per restare entro la dimensione gestibile dalle richieste REST.
  for (let start = 0; start < source.length; start += CLOUD_BATCH_SIZE) {
    const rows = source.slice(start, start + CLOUD_BATCH_SIZE).map(event => ({
      id: event.id,
      user_id: cloudSession.user.id,
      type: event.type,
      timestamp: event.timestamp
    }));
    await supabaseRequest('smokelog_events?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows)
    });
  }
}

async function fetchCloudEvents() {
  const eventsFromCloud = [];
  // Legge tutte le pagine: una singola risposta potrebbe non contenere l'intero storico.
  for (let start = 0; ; start += CLOUD_BATCH_SIZE) {
    const rows = await supabaseRequest('smokelog_events?select=id,type,timestamp&order=timestamp.asc', {
      headers: {
        Range: `${start}-${start + CLOUD_BATCH_SIZE - 1}`,
        'Range-Unit': 'items'
      }
    });
    eventsFromCloud.push(...rows.map(row => ({ id: row.id, type: row.type, timestamp: row.timestamp })));
    if (rows.length < CLOUD_BATCH_SIZE) break;
  }
  return eventsFromCloud;
}

function syncCloudEvents() {
  // Accorpa le sincronizzazioni concorrenti per evitare letture/scritture duplicate.
  if (cloudSyncPromise) return cloudSyncPromise;
  cloudSyncPromise = performCloudSync().finally(() => {
    cloudSyncPromise = null;
  });
  return cloudSyncPromise;
}

async function performCloudSync() {
  if (!cloudSession || !cloudSession.user || !cloudSession.user.id) {
    throw new Error('La sessione non contiene un account valido. Accedi di nuovo.');
  }
  const userId = cloudSession.user.id;
  const ensureSessionActive = () => {
    if (!cloudSession || !cloudSession.user || cloudSession.user.id !== userId) {
      throw new Error('La sessione è terminata durante la sincronizzazione. Accedi di nuovo.');
    }
  };
  // La copia locale viene caricata solo al primo collegamento; gli accessi successivi seguono il cloud.
  const localEvents = (await readAllEvents()).map(event => {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(event.id)) return event;
    return { ...event, id: makeId() };
  });
  ensureSessionActive();
  const remoteEvents = await fetchCloudEvents();
  ensureSessionActive();
  const previousUserId = localStorage.getItem(LAST_SYNC_USER_KEY);
  if (previousUserId && previousUserId !== userId && localEvents.length > 0) {
    // Evita di associare per errore allo stesso account dati locali appartenenti a un altro utente.
    const approved = await openActionDialog({
      title: 'Cambiare account?',
      message: 'Questo dispositivo contiene uno storico sincronizzato con un altro account. Accedendo, lo storico locale verrà sostituito con quello del nuovo account. Esporta prima un backup JSON se vuoi conservarlo.',
      confirmLabel: 'Cambia account',
      danger: true
    });
    if (!approved) {
      clearCloudSession();
      throw new Error('Accesso annullato: lo storico locale è rimasto invariato.');
    }
  }

  let nextEvents = remoteEvents;
  if (!previousUserId && localEvents.length > 0) {
    const byId = new Map(remoteEvents.map(event => [event.id, event]));
    for (const event of localEvents) byId.set(event.id, event);
    nextEvents = [...byId.values()];
    await uploadCloudEvents(localEvents);
    ensureSessionActive();
  }
  await replaceAllEvents(nextEvents);
  ensureSessionActive();
  events = [...nextEvents].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  render();
  localStorage.setItem(LAST_SYNC_USER_KEY, userId);
  isAuthenticated = true;
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
  elements.confirmPassword.setCustomValidity(
    elements.confirmPassword.value === elements.accountPassword.value ? '' : 'Le password non corrispondono.'
  );
  if (!elements.accountEmail.reportValidity()
    || !elements.accountPassword.reportValidity()
    || !elements.confirmPassword.reportValidity()) return;
  setAuthRequestPending(true, 'signup');
  try {
    // Con la conferma email attiva Supabase crea l'utente senza restituire una sessione.
    const result = await supabaseAuthRequest('signup', {
      email: elements.accountEmail.value.trim(),
      password: elements.accountPassword.value
    }, null, { redirect_to: new URL('./', location.href).href });
    if (result.access_token) {
      if (!result.refresh_token || !result.user || !result.user.id) {
        throw new Error('Supabase non ha restituito una sessione valida per il nuovo account.');
      }
      awaitingEmailConfirmation = false;
      saveCloudSession(result);
      elements.accountPassword.value = '';
      elements.confirmPassword.value = '';
      try {
        await syncCloudEvents();
      } catch (error) {
        throw new Error(`Account creato e accesso effettuato, ma sincronizzazione non riuscita: ${error.message || 'controlla la connessione e la configurazione del database.'}`);
      }
      return;
    }
    if (!result.user || !result.user.id) {
      throw new Error('Supabase non ha confermato la creazione dell’account. Riprova e controlla Authentication → Logs nel progetto.');
    }
    awaitingEmailConfirmation = true;
    updateAccountControls();
    elements.accountPassword.value = '';
    elements.confirmPassword.value = '';
    if (result.user && Array.isArray(result.user.identities) && result.user.identities.length === 0) {
      setAccountStatus('Questo indirizzo risulta già registrato: ripetere la registrazione non invia necessariamente una nuova email. Se l’account non è ancora confermato, usa il pulsante qui sotto per richiedere un nuovo messaggio. Se è già confermato, torna all’accesso.', false, true);
      return;
    }
    setAccountStatus('Supabase ha accettato la registrazione. Questo non conferma che l’email sia stata consegnata: controlla posta in arrivo e spam. Se non arriva, verifica Authentication → Users e Authentication → Logs; il mittente di prova Supabase è limitato e per altri destinatari serve SMTP personalizzato.', false, true);
  } catch (error) {
    console.error(error);
    setAccountStatus(error.message || 'Creazione account non riuscita.', true);
  } finally {
    setAuthRequestPending(false);
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
  try {
    await supabaseAuthRequest('logout', {}, cloudSession.access_token);
    clearCloudSession();
    await clearAllEvents();
    events = [];
    render();
    setAccountStatus('Disconnesso. Lo storico remoto è conservato nel tuo account.');
  } catch (error) {
    console.error(error);
    setAccountStatus(error.message || 'Disconnessione non riuscita.', true);
  }
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
    setAccountStatus('Accedi o crea un account per sincronizzare lo storico online.');
    return;
  }
  try {
    const session = JSON.parse(stored);
    if (!session.access_token || !session.refresh_token) {
      throw new Error('Sessione locale non valida.');
    }
    cloudSession = session;
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
    await syncCloudEvents();
    if (isPasswordRecovery) {
      isAuthenticated = false;
      updateAccountControls();
      openAuthenticationModal();
      setAccountStatus('Imposta una nuova password per il tuo account.');
    }
  } catch (error) {
    console.error(error);
    if (error.authSessionCleared) return;
    isAuthenticated = false;
    updateAccountControls();
    setAccountStatus(error.message || 'Impossibile ripristinare la sessione cloud.', true);
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
        // Un logout in un'altra scheda deve rimuovere anche la copia locale protetta dal gate.
        cloudSession = null;
        isAuthenticated = false;
        Promise.resolve(cloudSyncPromise).catch(() => {}).then(() => clearAllEvents()).then(() => {
          events = [];
          render();
          updateAccountControls();
          setAccountStatus('Sessione terminata in un’altra scheda. Accedi di nuovo per continuare.');
        }).catch(error => {
          console.error(error);
          updateAccountControls();
          setAccountStatus('Sessione terminata in un’altra scheda; non è stato possibile svuotare la copia locale.', true);
        });
      } else if (event.newValue && !isAuthenticated) {
        void restoreCloudSession();
      }
    }
  });
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
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
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
    request.onblocked = () => reject(new Error('Chiudi eventuali altre schede di SmokeLog e riprova.'));
  });
  databaseOpening.then(
    () => { databaseOpening = null; },
    () => { databaseOpening = null; }
  );
  return databaseOpening;
}

async function createDatabaseTransaction(mode) {
  // Alcuni browser chiudono la connessione inattiva: riaprila e riprova una sola volta.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const currentDatabase = await openDatabase();
    try {
      return currentDatabase.transaction(STORE_NAME, mode);
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

async function readAllEvents() {
  const tx = await createDatabaseTransaction('readonly');
  const done = transactionDone(tx);
  const request = tx.objectStore(STORE_NAME).getAll();
  const result = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error || new Error('Impossibile leggere lo storico.'));
  });
  await done;
  return result.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

async function persistEvent(event) {
  const tx = await createDatabaseTransaction('readwrite');
  tx.objectStore(STORE_NAME).add(event);
  await transactionDone(tx);
}

async function removeEvent(id) {
  const tx = await createDatabaseTransaction('readwrite');
  tx.objectStore(STORE_NAME).delete(id);
  await transactionDone(tx);
}

async function replaceAllEvents(importedEvents) {
  const tx = await createDatabaseTransaction('readwrite');
  const store = tx.objectStore(STORE_NAME);
  store.clear();
  for (const event of importedEvents) store.put(event);
  await transactionDone(tx);
}

async function clearAllEvents() {
  const tx = await createDatabaseTransaction('readwrite');
  tx.objectStore(STORE_NAME).clear();
  await transactionDone(tx);
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
  let cigarettes = 0;
  let joints = 0;
  let halfCigarettes = 0;
  let puzzetta = 0;
  let puff = 0;
  for (const event of source) {
    if (event.type === 'cigarette') cigarettes += 1;
    if (event.type === 'joint') joints += 1;
    if (event.type === 'half-cigarette') halfCigarettes += 1;
    if (event.type === 'puzzetta') puzzetta += 1;
    if (event.type === 'puff') puff += 1;
  }
  return {
    total: cigarettes + joints + halfCigarettes + puzzetta + puff,
    cigarettes,
    joints,
    halfCigarettes,
    puzzetta,
    puff
  };
}

function eventLabel(type) {
  return Object.prototype.hasOwnProperty.call(EVENT_LABELS, type) ? EVENT_LABELS[type] : 'Registrazione';
}

function formatNumber(number) {
  return new Intl.NumberFormat('it-IT').format(number);
}

function capitalizeFirst(value) {
  return value ? value.charAt(0).toLocaleUpperCase('it-IT') + value.slice(1) : value;
}

function formatDateTime(timestamp) {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return 'Data non valida';
  return `${capitalizeFirst(date.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' }))} · ${date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;
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

function renderChart(range, periodEvents, now = new Date()) {
  const buckets = makeBuckets(range, now);
  for (const bucket of buckets) {
    bucket.count = periodEvents.filter(event => withinRange(event, bucket.start, bucket.end)).length;
  }
  const maxCount = Math.max(1, ...buckets.map(bucket => bucket.count));
  elements.chartBars.replaceChildren();

  for (const bucket of buckets) {
    const row = document.createElement('div');
    row.className = 'chart-row';
    const label = document.createElement('span');
    label.className = 'chart-label';
    label.textContent = bucket.label;
    const track = document.createElement('div');
    track.className = 'bar-track';
    track.setAttribute('aria-label', `${bucket.label}: ${bucket.count}`);
    const fill = document.createElement('div');
    fill.className = 'bar-fill';
    fill.style.width = `${bucket.count === 0 ? 0 : Math.max(5, (bucket.count / maxCount) * 100)}%`;
    track.append(fill);
    const count = document.createElement('span');
    count.className = 'chart-count';
    count.textContent = String(bucket.count);
    row.append(label, track, count);
    elements.chartBars.append(row);
  }

  const titles = {
    day: ['Distribuzione di oggi', 'Per fascia oraria'],
    week: ['Ultimi sette giorni', 'Registrazioni per giorno'],
    month: ['Andamento del mese', 'Registrazioni per settimana del mese'],
    year: ['Andamento dell’anno', 'Registrazioni per mese']
  };
  elements.chartTitle.textContent = titles[range][0];
  elements.chartSubtitle.textContent = titles[range][1];
  elements.chartTotalPill.textContent = `${formatNumber(periodEvents.length)} totali`;
  if (periodEvents.length === 0) {
    const note = document.createElement('p');
    note.className = 'chart-empty-note';
    note.textContent = 'Nessuna registrazione in questo periodo. Il grafico si aggiornerà quando aggiungerai un evento.';
    elements.chartBars.append(note);
  }
}

function renderHistory() {
  const sorted = [...events].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const visible = sorted.slice(0, MAX_RECENT_EVENTS);
  elements.historyList.replaceChildren();
  elements.historyCount.textContent = `${formatNumber(events.length)} ${events.length === 1 ? 'evento' : 'eventi'}`;
  elements.historyFootnote.textContent = events.length > MAX_RECENT_EVENTS
    ? `Mostrate le ${MAX_RECENT_EVENTS} registrazioni più recenti su ${formatNumber(events.length)}. Esporta un CSV per consultare l’intero storico.`
    : 'Puoi rimuovere una registrazione con il pulsante − accanto all’evento.';

  if (visible.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const icon = document.createElement('span');
    icon.className = 'empty-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '＋';
    const title = document.createElement('strong');
    title.textContent = 'Ancora nessuna registrazione';
    const description = document.createElement('p');
    description.textContent = 'Quando aggiungerai una registrazione, la troverai qui.';
    empty.append(icon, title, description);
    elements.historyList.append(empty);
    return;
  }

  for (const event of visible) {
    const label = eventLabel(event.type);
    const row = document.createElement('div');
    row.className = 'history-item';
    const icon = document.createElement('span');
    icon.className = `history-type-icon ${event.type}`;
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = event.type === 'cigarette' || event.type === 'half-cigarette' ? '↗' : event.type === 'puff' ? '▱' : '✳';
    const main = document.createElement('div');
    main.className = 'history-item-main';
    const title = document.createElement('p');
    title.className = 'history-item-title';
    title.textContent = label;
    const date = document.createElement('p');
    date.className = 'history-item-date';
    date.textContent = formatDateTime(event.timestamp);
    main.append(title, date);
    const remove = document.createElement('button');
    remove.className = 'delete-event';
    remove.type = 'button';
    remove.textContent = '−';
    remove.setAttribute('aria-label', `Elimina registrazione: ${label}, ${formatDateTime(event.timestamp)}`);
    remove.addEventListener('click', () => handleDeleteEvent(event));
    row.append(icon, main, remove);
    elements.historyList.append(row);
  }
}

function render() {
  const now = new Date();
  elements.currentDate.textContent = capitalizeFirst(now.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
  const todayEvents = filterForRange('day', now);
  const todayCounts = countTypes(todayEvents);
  elements.todayTotal.textContent = formatNumber(todayCounts.total);
  elements.todayTotalLabel.textContent = todayCounts.total === 1 ? 'registrazione' : 'registrazioni';
  elements.todayCigarettes.textContent = formatNumber(todayCounts.cigarettes);
  elements.todayJoints.textContent = formatNumber(todayCounts.joints);
  elements.todayHalfCigarettes.textContent = formatNumber(todayCounts.halfCigarettes);
  elements.todayPuzzetta.textContent = formatNumber(todayCounts.puzzetta);
  elements.todayPuff.textContent = formatNumber(todayCounts.puff);

  const labels = { day: 'Totale di oggi', week: 'Totale ultimi 7 giorni', month: 'Totale del mese', year: 'Totale dell’anno' };
  const periodEvents = filterForRange(activeRange, now);
  const counts = countTypes(periodEvents);
  elements.periodLabel.textContent = labels[activeRange];
  elements.periodTotal.textContent = formatNumber(counts.total);
  elements.periodCigarettes.textContent = formatNumber(counts.cigarettes);
  elements.periodJoints.textContent = formatNumber(counts.joints);
  elements.periodHalfCigarettes.textContent = formatNumber(counts.halfCigarettes);
  elements.periodPuzzetta.textContent = formatNumber(counts.puzzetta);
  elements.periodPuff.textContent = formatNumber(counts.puff);
  renderChart(activeRange, periodEvents, now);
  renderHistory();
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
  if (!isAuthenticated) {
    openAuthenticationModal();
    return;
  }
  let uploaded = false;
  try {
    const event = { id: makeId(), type, timestamp: new Date().toISOString() };
    if (cloudConfigured) {
      await uploadCloudEvents([event]);
      uploaded = true;
    }
    await persistEvent(event);
    events.push(event);
    events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    render();
    showToast(`${eventLabel(type)} registrat${type === 'joint' ? 'o' : 'a'}.`);
  } catch (error) {
    console.error(error);
    if (uploaded) {
      showToast('Salvata online; aggiornamento locale non riuscito.', 'error');
      return;
    }
    if (type === 'puff' && error instanceof Error && /smokelog_events_type_check|check constraint/i.test(error.message)) {
      showToast('Cartuccia Puff non è ancora abilitata nel database. In Supabase → SQL Editor esegui di nuovo il file supabase-schema.sql aggiornato.', 'error');
      return;
    }
    const detail = error instanceof Error && error.message ? ` ${error.message}` : '';
    showToast(`Non salvata online: verifica la connessione e riprova.${detail}`, 'error');
  }
}

async function handleDeleteEvent(event) {
  if (!isAuthenticated) {
    openAuthenticationModal();
    return;
  }
  const typeLabel = eventLabel(event.type);
  const approved = await openActionDialog({
    title: 'Sicuro che non l’hai fumata?',
    message: `${typeLabel} · ${formatDateTime(event.timestamp)}. La registrazione verrà rimossa dallo storico sincronizzato.`,
    confirmLabel: 'Sì, elimina',
    danger: true
  });
  if (!approved) return;
  try {
    if (cloudConfigured) {
      await supabaseRequest(`smokelog_events?id=eq.${encodeURIComponent(event.id)}`, { method: 'DELETE' });
    }
    await removeEvent(event.id);
    events = events.filter(item => item.id !== event.id);
    render();
    showToast('Registrazione eliminata.');
  } catch (error) {
    console.error(error);
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
  if (!isAuthenticated) {
    openAuthenticationModal();
    return;
  }
  const backup = {
    app: 'SmokeLog',
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    events: [...events].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
  };
  downloadFile(`smokelog-backup-${localDateKey(new Date())}.json`, JSON.stringify(backup, null, 2), 'application/json;charset=utf-8');
  showToast('Backup JSON preparato. Salvalo in un luogo sicuro.');
}

function csvEscape(value) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function exportCsv() {
  if (!isAuthenticated) {
    openAuthenticationModal();
    return;
  }
  const rows = [['id', 'tipo', 'data_ora_iso', 'data_locale', 'ora_locale']];
  const sorted = [...events].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  for (const event of sorted) {
    const date = new Date(event.timestamp);
    rows.push([
      event.id,
      eventLabel(event.type),
      event.timestamp,
      date.toLocaleDateString('it-IT'),
      date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
    ]);
  }
  const csv = '\uFEFF' + rows.map(row => row.map(csvEscape).join(';')).join('\r\n');
  downloadFile(`smokelog-storico-${localDateKey(new Date())}.csv`, csv, 'text/csv;charset=utf-8');
  showToast('CSV preparato per il salvataggio o l’apertura in un foglio di calcolo.');
}

function validateBackup(parsed) {
  if (!parsed || parsed.app !== 'SmokeLog' || parsed.schemaVersion !== 1 || !Array.isArray(parsed.events)) {
    throw new Error('Il file non sembra un backup SmokeLog valido.');
  }
  const seen = new Set();
  const validated = [];
  // Convalida l'intero file prima di modificare l'archivio corrente.
  for (const item of parsed.events) {
    if (!item || typeof item.id !== 'string' || !Object.hasOwn(EVENT_LABELS, item.type) || typeof item.timestamp !== 'string' || !Number.isFinite(Date.parse(item.timestamp))) {
      throw new Error('Il backup contiene una registrazione non valida. Nessun dato è stato modificato.');
    }
    let id = item.id;
    if (seen.has(id)) id = makeId();
    seen.add(id);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : makeId();
    validated.push({ id: uuid, type: item.type, timestamp: new Date(item.timestamp).toISOString() });
  }
  return validated;
}

async function importJsonFile(file) {
  if (!file) return;
  try {
    if (!isAuthenticated) {
      openAuthenticationModal();
      return;
    }
    const raw = await file.text();
    const parsed = JSON.parse(raw);
    const validated = validateBackup(parsed);
    // L'importazione sostituisce lo storico locale e cloud, non lo unisce.
    const approved = await openActionDialog({
      title: 'Sostituire lo storico?',
      message: `Il backup contiene ${validated.length} registrazioni e sostituirà tutti i dati attuali, anche quelli sincronizzati. Esporta prima un backup se vuoi conservarli.`,
      confirmLabel: 'Importa backup',
      danger: true
    });
    if (!approved) return;
    if (cloudConfigured) {
      await supabaseRequest('rpc/replace_smokelog_events', {
        method: 'POST',
        body: JSON.stringify({ p_events: validated })
      });
    }
    await replaceAllEvents(validated);
    events = await readAllEvents();
    render();
    showToast(`Importate ${validated.length} registrazioni.`);
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
  if (!isAuthenticated) {
    openAuthenticationModal();
    return;
  }
  if (events.length === 0) {
    showToast('Non ci sono registrazioni da eliminare.', 'info');
    return;
  }
  const approved = await openActionDialog({
    title: 'Eliminare tutto lo storico?',
    message: `Stai per eliminare tutte le ${events.length} registrazioni dall’account e da questo dispositivo. L’operazione non si può annullare. Esporta prima un backup se vuoi conservarle.`,
    confirmLabel: 'Sì, elimina tutto',
    danger: true
  });
  if (!approved) return;
  try {
    if (cloudConfigured) {
      await supabaseRequest(`smokelog_events?user_id=eq.${encodeURIComponent(cloudSession.user.id)}`, { method: 'DELETE' });
    }
    await clearAllEvents();
    events = [];
    render();
    showToast('Storico eliminato.');
  } catch (error) {
    console.error(error);
    showToast('Non è stato possibile eliminare lo storico.', 'error');
  }
}

async function updateStorageStatus() {
  if (!navigator.storage || typeof navigator.storage.persisted !== 'function') {
    elements.storageStatus.textContent = 'Questo browser non permette a SmokeLog di richiedere la protezione dell’archivio. Conserva periodicamente un backup JSON.';
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
  document.getElementById('add-cigarette').addEventListener('click', () => handleAddEvent('cigarette'));
  document.getElementById('add-joint').addEventListener('click', () => handleAddEvent('joint'));
  document.getElementById('add-half-cigarette').addEventListener('click', () => handleAddEvent('half-cigarette'));
  document.getElementById('add-puzzetta').addEventListener('click', () => handleAddEvent('puzzetta'));
  document.getElementById('add-puff').addEventListener('click', () => handleAddEvent('puff'));
  document.querySelectorAll('[data-range]').forEach(button => {
    button.addEventListener('click', () => {
      activeRange = button.dataset.range;
      document.querySelectorAll('[data-range]').forEach(option => {
        const selected = option === button;
        option.classList.toggle('is-active', selected);
        option.setAttribute('aria-pressed', String(selected));
      });
      render();
    });
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
  setupAuthenticationEvents();
}

async function init() {
  // Prepara UI e archivio prima di ripristinare la sessione, che può attivare la sincronizzazione.
  setupEventHandlers();
  updateAccountControls();
  try {
    await openDatabase();
    events = await readAllEvents();
    if (cloudConfigured) events = [];
    render();
    await updateStorageStatus();
  } catch (error) {
    console.error(error);
    await openActionDialog({
      title: 'Archivio non disponibile',
      message: `SmokeLog non riesce ad aprire l’archivio locale. Prova con una versione recente di Safari o di un browser compatibile. Dettaglio: ${error.message || 'errore sconosciuto'}`,
      notice: true
    });
  }

  if (cloudConfigured) {
    await restoreCloudSession();
  } else {
    setAccountStatus('Sincronizzazione non configurata. Completa la configurazione Supabase descritta nel README.');
  }

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('./service-worker.js').catch(error => console.warn('Service worker non registrato:', error));
  }
}

document.addEventListener('DOMContentLoaded', init);
