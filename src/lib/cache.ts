type CacheEnvelope<T> = {
  value: T;
  timestamp: number;
};

function readEnvelope<T>(key: string): CacheEnvelope<T> | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.sessionStorage.getItem(key);

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as CacheEnvelope<T>;
  } catch {
    window.sessionStorage.removeItem(key);
    return null;
  }
}

export function readSessionCache<T>(key: string, maxAgeMs = 1000 * 60 * 10): T | null {
  const envelope = readEnvelope<T>(key);

  if (!envelope) {
    return null;
  }

  if (Date.now() - envelope.timestamp > maxAgeMs) {
    window.sessionStorage.removeItem(key);
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
  if (typeof window === "undefined") {
    return;
  }

  const payload: CacheEnvelope<T> = {
    value,
    timestamp: Date.now(),
  };

  window.sessionStorage.setItem(key, JSON.stringify(payload));
}
