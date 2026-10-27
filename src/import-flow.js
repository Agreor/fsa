export async function prepareImport({ bytes, name, accountId, source, reader, askPassword }) {
  if (!bytes?.byteLength || !name || !accountId) return { status: 'rejected', reason: 'Choose a non-empty file and account.' };
  const read = await reader.extractPdf(bytes, askPassword);
  if (read?.error) return { status: 'rejected', code: read.error };
  const parsed = await source.parse(read.pages, { account: accountId });
  if (parsed?.reason) return { status: 'rejected', reason: parsed.reason };
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const fileHash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return { status: 'ready', parsed, fileHash };
}

export async function commitImport({ parsed, fileHash, name, accountId, store }) {
  const result = await store.addBatch(accountId, parsed, { fileHash, name });
  if (result.duplicateFile) return { status: 'duplicate_file', added: 0, skipped: result.skipped };
  return { status: 'imported', batchId: result.batchId, added: result.added, skipped: result.skipped };
}

export function capturePreview(prepared, { name, accountId }) {
  return { ...prepared, name, accountId };
}

export async function savePreview(preview, store) {
  const { parsed, fileHash, name, accountId } = preview;
  return commitImport({ parsed, fileHash, name, accountId, store });
}

export async function runImport(input) {
  const prepared = await prepareImport(input);
  if (prepared.status !== 'ready') return prepared;
  return commitImport({ ...prepared, name: input.name, accountId: input.accountId, store: input.store });
}
