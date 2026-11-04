async function init() {
  // Prepara UI e archivio prima di ripristinare la sessione, che può attivare la sincronizzazione.
  loadStatsPreferences();
  setInterval(() => { if (isAppReady && document.visibilityState === 'visible') render(); }, 60000);
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
    setupAppUpdates();
  }
}

document.addEventListener('DOMContentLoaded', init);
