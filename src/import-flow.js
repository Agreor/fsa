export async function prepareImport({ bytes, name, accountId, source, reader, askPassword, ocr }) {
  if (!bytes?.byteLength || !name || !accountId) return { status: 'rejected', reason: 'Choose a non-empty file and account.' };
  const digest = async () => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // %PDF
  if (source.readPicture && isPdf) { // a statement that is a picture: render the pages and read them
    if (!ocr) return { status: 'rejected', reason: 'Reading pictures is not available here.' };
    const pages = await reader.renderPages(bytes, { scale: 3, makeCanvas: ocr.makeCanvas });
    const parsed = await source.readPicture(pages, ocr);
    return parsed?.reason ? { status: 'rejected', reason: parsed.reason } : { status: 'ready', parsed, fileHash: await digest() };
  }
  let input;
  if (source.input === 'text') input = new TextDecoder().decode(bytes);
  else {
    const read = await reader.extractPdf(bytes, askPassword);
    if (read?.error) return { status: 'rejected', code: read.error };
    input = read.pages;
  }
  const parsed = await source.parse(input, { account: accountId });
  if (parsed?.reason) return { status: 'rejected', reason: parsed.reason };
  return { status: 'ready', parsed, fileHash: await digest() };
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
