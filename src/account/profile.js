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
  const response = await cloudFetch(requestUrl.href, {
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
  const response = await cloudFetch(`${supabaseConfig.url.replace(/\/$/, '')}/storage/v1/${path}`, {
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
    const response = await cloudFetch(`${supabaseConfig.url.replace(/\/$/, '')}/auth/v1/user`, {
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

