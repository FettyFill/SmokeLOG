const fs = require('node:fs');
const vm = require('node:vm');
const { IDBFactory } = require('fake-indexeddb');

function harness() {
  const values = new Map();
  const indexedDB = new IDBFactory();
  const context = vm.createContext({
    console, structuredClone, setTimeout, clearTimeout, URL, Date,
    indexedDB, window: { indexedDB, crypto: require('node:crypto').webcrypto },
    localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) },
    document: { getElementById: () => ({}), querySelector: () => ({}), addEventListener() {} }
  });
  vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '../app.js'), 'utf8'), context);
  const run = code => vm.runInContext(code, context);
  run(`render = () => {}; updateAccountControls = () => {}; populateProfileSettings = () => {};
    closeAuthenticationModal = () => {}; setAccountStatus = () => {}; showToast = () => {};
    cloudSession = { user: { id: 'account', email: 'test@example.invalid' } };
    let remote = { ownerId: 'account', cursor: '0', events: [], purchases: [], categories: [] };
    let rejectUpload = false, uploaded = [];
    const originalFetchCloudSnapshot = fetchCloudSnapshot;
    fetchCloudSnapshot = async () => structuredClone(remote);
    uploadCloudData = async (events, purchases, categories) => {
      uploaded.push({ events, purchases, categories });
      if (!rejectUpload) {
        for (const [kind, incoming] of Object.entries({ events, purchases, categories })) remote[kind] = mergeById(remote[kind], incoming);
      }
    };`);
  return run;
}
module.exports = { harness };
