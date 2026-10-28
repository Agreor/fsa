export const ACCESS_SECRET_KEY = 'fsa.access';

export function createAccessSecret(storage) {
  return {
    get() {
      try {
        return storage.getItem(ACCESS_SECRET_KEY);
      } catch {
        return null;
      }
    },
    set(value) {
      try {
        storage.setItem(ACCESS_SECRET_KEY, value);
        return true;
      } catch {
        return false;
      }
    },
    clear() {
      try {
        storage.removeItem(ACCESS_SECRET_KEY);
      } catch {}
    },
  };
}
