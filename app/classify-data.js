export const NO_SECRET = 'Enter the access secret on the Data tab first. Nothing was sent.';

const ERRORS = {
  offline: 'You are offline. Nothing was sent; try again when you are connected.',
  unauthorized: 'The access secret was rejected. Check it on the Data tab.',
  unavailable: 'The classifier is not set up on the server yet.',
  busy: 'The classifier is busy. Nothing was lost; try again in a minute.',
  bad_request: 'The server refused this batch. Nothing was saved.',
  upstream: 'The classifier did not answer properly. Try again later.',
};
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// What the screen shows about a preview: the names that would be sent, and what stays behind.
export function previewView(preview) {
  const { localOnly = 0, notSendable = 0, ruled = 0 } = preview.skipped ?? {};
  const notes = [];
  if (localOnly) {
    const verb = localOnly === 1 ? 'stays' : 'stay';
    const count = plural(localOnly, 'transaction', 'transactions');
    notes.push(`${count} from bank accounts ${verb} on this device.`);
  }
  if (notSendable) {
    notes.push(`${plural(notSendable, 'transaction was', 'transactions were')} skipped because the text `
      + 'looks personal.');
  }
  if (ruled) {
    notes.push(`${plural(ruled, 'transaction already has', 'transactions already have')} a category.`);
  }
  return { items: preview.items.map(({ text, count }) => ({ text, count })), notes };
}

export function resultMessage(result, errorCode) {
  if (result.unknownPreview) return 'This list is out of date. Find merchants again.';
  const saved = result.saved
    ? ` ${plural(result.saved, 'category was', 'categories were')} saved first.` : '';
  if (result.retryLater) return `${ERRORS[errorCode] ?? ERRORS.upstream}${saved}`;
  if (!result.saved) return 'No name came back with enough confidence, so nothing changed.';
  return `Saved ${plural(result.saved, 'category', 'categories')}. `
    + 'Names the classifier was unsure about stay uncategorised.';
}

// One categories instance serves find() and send(): its preview snapshots live in that instance.
export function createClassifyFlow({ makeCategories, listRows, classifier, hasSecret, refresh }) {
  let current = null;
  const spending = async () => (await listRows()).filter((row) => row.amount < 0);
  return {
    async find() {
      const categories = makeCategories();
      const preview = await categories.preview(await spending());
      current = { categories, preview };
      return previewView(preview);
    },
    async send(texts) {
      if (!current) return { message: 'Find merchants first.', done: false };
      if (!hasSecret()) return { message: NO_SECRET, done: false };
      // The data may have changed since the list was made (an import undone, a rule added): send only
      // names that are still on a fresh list.
      const fresh = await current.categories.preview(await spending());
      const live = new Set(fresh.items.map(({ text }) => text));
      const approved = texts.filter((text) => live.has(text));
      if (!approved.length) {
        current = null;
        return { message: resultMessage({ unknownPreview: true }), done: true };
      }
      current.preview = fresh;
      let code = null;
      const classify = async (batch) => {
        try { return await classifier.classify(batch); } catch (error) {
          code = error.code ?? 'upstream';
          throw error;
        }
      };
      const result = await current.categories.classifyApproved(fresh, approved, classify);
      const done = !result.retryLater;
      if (done) current = null;
      if (result.saved) {
        try { await refresh(); } catch {}
      }
      return { message: resultMessage(result, code), done };
    },
    cancel() { current = null; },
  };
}
