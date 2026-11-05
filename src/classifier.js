const MAX_TEXTS = 50;

function makeError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

// What the 503 body says: busy (retry later) or anything else (not set up).
async function unavailableCode(response) {
  try {
    return (await response.json())?.error === 'busy' ? 'busy' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

export function createClassifierClient({ fetch, baseUrl, getSecret }) {
  return {
    async classify(texts) {
      if (!Array.isArray(texts) || !texts.length || texts.length > MAX_TEXTS) {
        throw makeError('bad_request');
      }
      let response;
      try {
        response = await fetch(`${baseUrl}/classify`, { method: 'POST',
          headers: { Authorization: `Bearer ${getSecret()}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ texts }) });
      } catch {
        throw makeError('offline');
      }
      if (response.status === 401) throw makeError('unauthorized');
      if (response.status === 503) throw makeError(await unavailableCode(response));
      if (response.status === 400 || response.status === 413) throw makeError('bad_request');
      if (response.status !== 200) throw makeError('upstream');
      let payload;
      try {
        payload = await response.json();
      } catch {
        throw makeError('upstream');
      }
      const found = payload?.categories;
      if (found === null || typeof found !== 'object' || Array.isArray(found)) {
        throw makeError('upstream');
      }
      return Object.fromEntries(texts.filter((text) => Object.hasOwn(found, text)
        && typeof found[text] === 'string').map((text) => [text, found[text]]));
    },
  };
}
