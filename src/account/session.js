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
    activeOwnerId = result.user.id;
    events = await readAllEvents(activeOwnerId);
    purchases = await readAllPurchases(activeOwnerId);
    categories = await loadCategoriesForOwner(activeOwnerId);
    isAuthenticated = true;
    render(); updateAccountControls();
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
    const response = await cloudFetch(`${supabaseConfig.url.replace(/\/$/, '')}/auth/v1/recover?redirect_to=${encodeURIComponent(new URL('./', location.href).href)}`, {
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
    const response = await cloudFetch(`${supabaseConfig.url.replace(/\/$/, '')}/auth/v1/user`, {
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
    const response = await cloudFetch(`${supabaseConfig.url.replace(/\/$/, '')}/functions/v1/delete-account`, {
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
    localStorage.removeItem(WELLNESS_KEY + userId);
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
    let user = await cloudFetch(`${supabaseConfig.url.replace(/\/$/, '')}/auth/v1/user`, {
      headers: {
        apikey: supabaseConfig.anonKey,
        Authorization: `Bearer ${cloudSession.access_token}`
      }
    });
    if (user.status === 401) {
      // Un token scaduto o revocato viene rinnovato una volta anche se expires_at sembrava valido.
      saveCloudSession(await refreshCloudSession(cloudSession.refresh_token));
      user = await cloudFetch(`${supabaseConfig.url.replace(/\/$/, '')}/auth/v1/user`, {
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
  if (isAppReady) {
    events = await readAllEvents();
    purchases = await readAllPurchases();
    render();
  }
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

