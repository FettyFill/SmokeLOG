function setupEventHandlers() {
  setupGoals();
  setupEnhancements();
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
    const time = document.getElementById('purchase-timestamp');
    if (!time.value || !time.checkValidity() || !Number.isFinite(Date.parse(time.value)) || Date.parse(time.value) > Date.now()) {
      elements.purchaseFormError.textContent = 'Inserisci una data valida, non futura.'; elements.purchaseFormError.hidden = false; return;
    }
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

