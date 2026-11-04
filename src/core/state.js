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
  joint: 'Cannabis',
  'half-cigarette': 'Mezza sigaretta',
  puzzetta: 'Altro prodotto',
  puff: 'Cartuccia Puff'
};
const DEFAULT_EVENT_CATEGORIES = [
  { id: 'cigarette', name: 'Sigaretta', color: 'blue' },
  { id: 'joint', name: 'Cannabis', color: 'mint' },
  { id: 'half-cigarette', name: 'Mezza sigaretta', color: 'violet' },
  { id: 'puzzetta', name: 'Altro prodotto', color: 'amber' },
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

