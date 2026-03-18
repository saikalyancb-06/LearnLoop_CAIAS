type CacheEnvelope<T> = {
  value: T;
  timestamp: number;
};

export const UI_CACHE_MAX_AGE = 1000 * 60 * 30;
export const THEME_CACHE_MAX_AGE = 1000 * 60 * 60 * 24 * 30;

function getSessionStorage() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.sessionStorage;
}

function getLocalStorage() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage;
}

function readEnvelope<T>(key: string): CacheEnvelope<T> | null {
  const storages = [getSessionStorage(), getLocalStorage()].filter(Boolean);

  for (const storage of storages) {
    const raw = storage.getItem(key);

    if (!raw) {
      continue;
    }

    try {
      const envelope = JSON.parse(raw) as CacheEnvelope<T>;
      const sessionStorage = getSessionStorage();

      if (storage === getLocalStorage() && sessionStorage) {
        sessionStorage.setItem(key, raw);
      }

      return envelope;
    } catch {
      storage.removeItem(key);
    }
  }

  return null;
}

export function readSessionCache<T>(key: string, maxAgeMs = 1000 * 60 * 10): T | null {
  const envelope = readEnvelope<T>(key);

  if (!envelope) {
    return null;
  }

  if (Date.now() - envelope.timestamp > maxAgeMs) {
    removeSessionCache(key);
    return null;
  }

  return envelope.value;
}

export function isSessionCacheFresh(key: string, maxAgeMs = 1000 * 60 * 10) {
  const envelope = readEnvelope(key);

  if (!envelope) {
    return false;
  }

  return Date.now() - envelope.timestamp <= maxAgeMs;
}

export function writeSessionCache<T>(key: string, value: T) {
  const sessionStorage = getSessionStorage();
  const localStorage = getLocalStorage();

  if (!sessionStorage && !localStorage) {
    return;
  }

  const payload: CacheEnvelope<T> = {
    value,
    timestamp: Date.now(),
  };

  const raw = JSON.stringify(payload);
  sessionStorage?.setItem(key, raw);
  localStorage?.setItem(key, raw);
}

export function removeSessionCache(key: string) {
  getSessionStorage()?.removeItem(key);
  getLocalStorage()?.removeItem(key);
}
