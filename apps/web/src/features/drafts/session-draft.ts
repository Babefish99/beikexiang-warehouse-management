export type DraftEnvelope<T> = {
  version: number;
  userId: string;
  value: T;
};

export function readSessionDraft<T>(
  storage: Storage,
  key: string,
  expectedUserId: string,
  version: number,
): T | null {
  try {
    const parsed = JSON.parse(storage.getItem(key) ?? "null") as DraftEnvelope<T> | null;
    return parsed !== null
      && typeof parsed === "object"
      && parsed.version === version
      && parsed.userId === expectedUserId
      && Object.prototype.hasOwnProperty.call(parsed, "value")
      ? parsed.value
      : null;
  } catch {
    return null;
  }
}

export function writeSessionDraft<T>(storage: Storage, key: string, envelope: DraftEnvelope<T>): void {
  storage.setItem(key, JSON.stringify(envelope));
}

export function clearSessionDraft(storage: Storage, key: string): void {
  storage.removeItem(key);
}
