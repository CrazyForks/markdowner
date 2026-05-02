import '@testing-library/jest-dom/vitest';

// jsdom in vitest 4 ships without a writable localStorage by default; install
// a minimal in-memory polyfill so app code that persists state through
// localStorage (sidebar width, theme mode, etc.) can be exercised in tests.
if (typeof window !== 'undefined') {
  const requiresPolyfill = (() => {
    try {
      return typeof window.localStorage?.setItem !== 'function';
    } catch {
      return true;
    }
  })();

  if (requiresPolyfill) {
    const store = new Map<string, string>();
    const storage: Storage = {
      get length() {
        return store.size;
      },
      clear: () => store.clear(),
      getItem: (key) => (store.has(key) ? store.get(key) ?? null : null),
      key: (index) => Array.from(store.keys())[index] ?? null,
      removeItem: (key) => {
        store.delete(key);
      },
      setItem: (key, value) => {
        store.set(key, String(value));
      },
    };

    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: storage,
    });
  }
}
