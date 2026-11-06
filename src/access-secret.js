export const ACCESS_SECRET_KEY = 'fsa.access';
export const PDF_PASSWORD_KEY = 'fsa.pdfpass'; // same kind of local value, kept apart from the access secret

export function createAccessSecret(storage, key = ACCESS_SECRET_KEY) {
  return {
    get() {
      try {
        return storage.getItem(key);
      } catch {
        return null;
      }
    },
    set(value) {
      try {
        storage.setItem(key, value);
        return true;
      } catch {
        return false;
      }
    },
    clear() {
      try {
        storage.removeItem(key);
      } catch {}
    },
  };
}
