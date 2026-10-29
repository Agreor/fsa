import * as pdfjs from './vendor/pdfjs/pdf.min.mjs';
import { createPdfReader } from './src/pdf-reader.js';
import { createStore, indexedDbBackend } from './src/store.js';
import { createTransfers } from './src/transfers.js';
import * as s1 from './src/sources/s1.js';
import * as s2 from './src/sources/s2.js';
import * as s5 from './src/sources/s5.js';
import { prepareImport, savePreview } from './src/import-flow.js';
import { KINDS, listAccounts, addAccount, createPreviewRunner, sharedHints,
  transferAccounts } from './accounts.js';
import { createSources } from './sources.js';
import { createFlow } from './flow.js';
import { createAccessSecret } from './src/access-secret.js';
import { createRateClient } from './src/rates.js';
import { createMonths } from './src/months.js';
import { createCategories } from './src/categories.js';
import { rowIdentity } from './src/contracts.js';
import { createCurrencySetting, convertedHeading, formatAmount } from './settings.js';
import { createLatest, createRatesFlow } from './rates-flow.js';
import { createMonthData, createActions } from './month-data.js';
import { renderMonth } from './month-screen.js';

const sources = createSources({ s1, s2, s5 });

const reader = createPdfReader({ pdfjs, workerSrc: './vendor/pdfjs/pdf.worker.min.mjs' });
const backend = indexedDbBackend('fsa');
const store = createStore(backend);
const flow = createFlow({ store, savePreview, makeTransfers: () => createTransfers({ backend,
  accounts: transferAccounts(listAccounts()) }) });
const $ = (selector) => document.querySelector(selector);
const accessStore = createAccessSecret(localStorage);
const currencySetting = createCurrencySetting(localStorage);
const rateClient = createRateClient({ fetch: (...args) => fetch(...args), baseUrl: '.',
  getSecret: () => accessStore.get() });
const ratesFlow = createRatesFlow({ client: rateClient, hasSecret: () => Boolean(accessStore.get()) });
const conversion = createLatest();
const monthRefresh = createLatest();
const makeTransfers = () => createTransfers({ backend, accounts: transferAccounts(listAccounts()) });
const makeMonths = () => {
  const accounts = listAccounts();
  return createMonths({ backend, accounts: transferAccounts(accounts), categories: createCategories({ backend,
    accountKinds: Object.fromEntries(accounts.map(({ id, kind }) => [id, kind])) }),
  transfers: makeTransfers(), client: rateClient });
};
const monthData = createMonthData({ listRows: () => store.listRows(), rowIdentity,
  ensureRates: (rows, currency) => ratesFlow.ensure(rows, currency), makeMonths, makeTransfers,
  listRoles: () => backend.list('role:'), formatAmount });
let selectedMonth = null;
$('#currency').value = currencySetting.get();
$('#converted-heading').textContent = convertedHeading($('#currency').value);
$('#secret-status').textContent = accessStore.get() ? 'Secret saved on this device.' : 'No secret saved.';
$('#save-secret').addEventListener('click', () => {
  const value = $('#secret').value;
  if (!value.trim()) return;
  accessStore.set(value); $('#secret').value = '';
  $('#secret-status').textContent = accessStore.get() ? 'Secret saved on this device.' : 'No secret saved.';
  if (prepared?.status === 'ready') updateConverted(prepared.parsed.rows);
  refreshMonth();
});
$('#clear-secret').addEventListener('click', () => {
  accessStore.clear(); $('#secret').value = ''; $('#secret-status').textContent = 'No secret saved.';
  if (prepared?.status === 'ready') updateConverted(prepared.parsed.rows);
  refreshMonth();
});
$('#currency').addEventListener('change', (event) => {
  conversion.next();
  const currency = currencySetting.set(event.currentTarget.value);
  if (prepared?.status === 'ready') updateConverted(prepared.parsed.rows);
  refreshMonth();
});
const accountSelect = $('#account-select');
$('#kind-select').replaceChildren(...KINDS.map((kind) => Object.assign(document.createElement('option'), {
  value: kind, textContent: ({ bank: 'Bank', debit_card: 'Debit card', credit_card: 'Credit card',
    broker: 'Broker', cash: 'Cash' })[kind],
})));
let prepared;
let askPassword;
let batches = [];
let lastActionError = '';
const saveButton = $('#save');
saveButton.disabled = true;
const previewRunner = createPreviewRunner({
  selection: () => ({ accountId: accountSelect.value, file: $('#file').files[0] }),
  prepare: async ({ bytes, name, accountId }) => {
    const account = listAccounts().find((item) => item.id === accountId);
    const source = sources.sourceModule(account?.source);
    if (!account || !source) return { status: 'rejected', reason: 'Choose an account with a known source.' };
    return prepareImport({ bytes, name, accountId, source, reader, askPassword });
  },
  save: (preview) => flow.save(preview),
});
function invalidatePreview() {
  conversion.next();
  previewRunner.invalidate(); prepared = undefined; saveButton.disabled = true; $('#preview').hidden = true;
}
accountSelect.addEventListener('change', invalidatePreview);
$('#file').addEventListener('change', invalidatePreview);

function renderAccounts() {
  const accounts = listAccounts();
  accountSelect.replaceChildren(...accounts.map(({ id, name }) => Object.assign(
    document.createElement('option'), { value: id, textContent: name })));
}
function renderBatches() {
  $('#batches').replaceChildren(...batches.map((batch) => {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.textContent = `Undo ${batch.name}`;
    button.addEventListener('click', async () => {
      try {
        const result = await flow.undo(batch.id);
        $('#message').textContent = result.reconcileError
          ? `Saved, but transfer matching failed: ${result.reconcileError}` : '';
      } catch (error) {
        $('#message').textContent = `Could not undo the import: ${error.message}`;
      } finally {
        await Promise.allSettled([refreshBatches(), refreshMonth()]);
      }
    });
    li.append(`${batch.name} `, button);
    return li;
  }));
}
async function refreshBatches() { batches = await store.listBatches(); renderBatches(); }
async function refreshMonth() {
  const ticket = monthRefresh.next();
  try {
    const data = await monthData.load(selectedMonth, $('#currency').value);
    if (!monthRefresh.isCurrent(ticket)) return;
    selectedMonth = data.empty ? null : data.month;
    const actions = createActions({ makeMonths, makeTransfers,
      report(message) { lastActionError = message; $('#month-status').textContent = message; },
      refresh: refreshMonth });
    renderMonth($('[data-month-screen]'), data, {
      onMonth(value) { selectedMonth = value; refreshMonth(); },
      onMark: (rowId, choice) => { lastActionError = ''; return actions.mark(rowId, choice); },
      onConfirm: (id) => { lastActionError = ''; return actions.confirm(id); },
      onNotTransfer: (rowIds) => { lastActionError = ''; return actions.notTransfer(rowIds); },
    });
    const ratesMessage = ({ no_secret: 'Enter the access secret to see converted amounts.',
      offline: 'Offline: converted amounts are unavailable.', unauthorized: 'The access secret was rejected.',
      upstream: 'Rates are unavailable right now.' })[data.ratesStatus?.status] ?? '';
    const incompleteMessage = data.incomplete && !ratesMessage
      ? data.incompleteNote : data.incomplete && ratesMessage ? ` ${data.incompleteNote}` : '';
    $('#month-status').textContent = [ratesMessage + incompleteMessage, lastActionError]
      .filter(Boolean).join(' ');
  } catch (error) {
    if (monthRefresh.isCurrent(ticket)) {
      $('#month-status').textContent = [lastActionError, `Could not load the month: ${error.message}`]
        .filter(Boolean).join(' ');
    }
  }
}
async function updateConverted(rows) {
  const ticket = conversion.next();
  const currency = $('#currency').value;
  const result = await ratesFlow.ensure(rows, currency);
  if (!conversion.isCurrent(ticket)) return;
  const converted = ratesFlow.convertRows(rows, currency);
  $('#converted-heading').textContent = convertedHeading(currency);
  const tableRows = $('#preview tbody').querySelectorAll('tr');
  if (tableRows.length === converted.items.length) tableRows.forEach((tr, index) => {
    const amount = converted.items[index].amount;
    tr.lastElementChild.textContent = amount === null ? '-' : formatAmount(amount, currency);
  });
  $('#rates-status').textContent = result.status === 'no_secret'
    ? 'Enter the access secret to see converted amounts.'
    : result.status === 'offline' ? 'Offline: converted amounts are unavailable.'
      : result.status === 'unauthorized' ? 'The access secret was rejected.'
        : result.status === 'upstream' ? 'Rates are unavailable right now.'
          : result.status === 'ok' && converted.partial ? 'Some amounts could not be converted.' : '';
}
function showRows(rows) {
  conversion.next();
  $('#preview tbody').replaceChildren(...rows.map((row) => {
    const tr = document.createElement('tr');
    const values = [row.date, row.description, `${(row.amount / 100).toFixed(2)} ${row.currency}`, '-'];
    for (const value of values) {
      const td = document.createElement('td'); td.textContent = value; tr.append(td);
    }
    return tr;
  }));
  $('#preview').hidden = false;
  updateConverted(rows);
}
$('#account-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const accounts = listAccounts();
  const label = String(data.get('name')).trim() || `Account ${accounts.length + 1}`;
  const added = addAccount({ name: label, source: data.get('source'), kind: data.get('kind'),
    hints: data.get('hints'), hintsAreEvidence: data.get('hintsAreEvidence') === 'on' });
  const warnings = sharedHints(added);
  $('#account-warning').textContent = warnings.map(({ hint, accounts: names }) =>
    `Two accounts share the word "${hint}": ${names.join(', ')}. `
      + 'Transfers may pair with the wrong one.').join(' ');
  event.currentTarget.reset(); renderAccounts();
});
$('#source-select').addEventListener('change', (event) => {
  $('#kind-select').value = sources.defaultsFor(event.currentTarget.value).kind;
});
$('#prepare').addEventListener('click', async () => {
  invalidatePreview();
  const selection = { accountId: accountSelect.value, file: $('#file').files[0] };
  const file = selection.file;
  if (!file || !file.size) { $('#message').textContent = 'Choose a non-empty file.'; return; }
  const password = $('#password');
  askPassword = async ({ wrong } = {}) => {
    $('#password-wrap').hidden = false;
    password.value = '';
    password.placeholder = wrong ? 'Try again' : '';
    password.focus();
    return new Promise((resolve) => password.addEventListener('change', () => {
      const value = password.value || null;
      password.value = '';
      resolve(value);
    }, { once: true }));
  };
  try {
    const result = await previewRunner.preview();
    password.value = ''; $('#password-wrap').hidden = true;
    if (!result) return;
    prepared = result;
    if (result.status !== 'ready') {
      conversion.next();
      $('#message').textContent = result.reason || result.code || 'This file could not be read.';
      return;
    }
    showRows(prepared.parsed.rows); saveButton.disabled = false; $('#message').textContent = '';
  } catch (error) {
    password.value = ''; $('#password-wrap').hidden = true;
    $('#message').textContent = error.message;
  }
});
$('#save').addEventListener('click', async () => {
  if (!prepared || prepared.status !== 'ready') return;
  try {
    const result = await previewRunner.save();
    $('#message').textContent = result.reconcileError
      ? `Saved, but transfer matching failed: ${result.reconcileError}`
      : result.status === 'duplicate_file' ? 'This file was already imported.' : 'Import saved.';
    invalidatePreview(); await refreshBatches(); refreshMonth();
  } catch (error) { $('#message').textContent = error.message; }
});
$('#cancel').addEventListener('click', () => { invalidatePreview(); $('#message').textContent = ''; });
renderAccounts(); refreshBatches(); refreshMonth();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
