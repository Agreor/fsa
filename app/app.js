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

const sources = createSources({ s1, s2, s5 });

const reader = createPdfReader({ pdfjs, workerSrc: './vendor/pdfjs/pdf.worker.min.mjs' });
const backend = indexedDbBackend('fsa');
const store = createStore(backend);
const flow = createFlow({ store, savePreview, makeTransfers: () => createTransfers({ backend,
  accounts: transferAccounts(listAccounts()) }) });
const $ = (selector) => document.querySelector(selector);
const accountSelect = $('#account-select');
$('#kind-select').replaceChildren(...KINDS.map((kind) => Object.assign(document.createElement('option'), {
  value: kind, textContent: ({ bank: 'Bank', debit_card: 'Debit card', credit_card: 'Credit card',
    broker: 'Broker', cash: 'Cash' })[kind],
})));
let prepared;
let askPassword;
let batches = [];
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
      const result = await flow.undo(batch.id);
      $('#message').textContent = result.reconcileError
        ? `Saved, but transfer matching failed: ${result.reconcileError}` : '';
      await refreshBatches();
    });
    li.append(`${batch.name} `, button);
    return li;
  }));
}
async function refreshBatches() { batches = await store.listBatches(); renderBatches(); }
function showRows(rows) {
  $('#preview tbody').replaceChildren(...rows.map((row) => {
    const tr = document.createElement('tr');
    for (const value of [row.date, row.description, `${(row.amount / 100).toFixed(2)} ${row.currency}`]) {
      const td = document.createElement('td'); td.textContent = value; tr.append(td);
    }
    return tr;
  }));
  $('#preview').hidden = false;
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
    prepared = await previewRunner.preview();
    password.value = ''; $('#password-wrap').hidden = true;
    if (!prepared) return;
    if (prepared.status !== 'ready') { $('#message').textContent = prepared.reason || prepared.code; return; }
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
    invalidatePreview(); await refreshBatches();
  } catch (error) { $('#message').textContent = error.message; }
});
$('#cancel').addEventListener('click', () => { invalidatePreview(); $('#message').textContent = ''; });
renderAccounts(); refreshBatches();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
