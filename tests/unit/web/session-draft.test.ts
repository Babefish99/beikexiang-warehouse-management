import { describe, expect, it } from "vitest";
import {
  clearSessionDraft,
  readSessionDraft,
  writeSessionDraft,
} from "../../../apps/web/src/features/drafts/session-draft";

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
}

describe("session draft", () => {
  it("round-trips a matching user and version", () => {
    const storage = createStorage();
    const value = { warehouseId: "wh-1", batchNo: "B-001" };

    writeSessionDraft(storage, "inbound", { version: 1, userId: "admin-1", value });

    expect(readSessionDraft(storage, "inbound", "admin-1", 1)).toEqual(value);
  });

  it("rejects another user or version", () => {
    const storage = createStorage();
    writeSessionDraft(storage, "inbound", {
      version: 1,
      userId: "admin-1",
      value: { warehouseId: "wh-1" },
    });

    expect(readSessionDraft(storage, "inbound", "admin-2", 1)).toBeNull();
    expect(readSessionDraft(storage, "inbound", "admin-1", 2)).toBeNull();
  });

  it("safely ignores corrupt data", () => {
    const storage = createStorage();
    storage.setItem("inbound", "not-json");

    expect(readSessionDraft(storage, "inbound", "admin-1", 1)).toBeNull();
    storage.setItem("inbound", JSON.stringify({ version: 1, userId: "admin-1" }));
    expect(readSessionDraft(storage, "inbound", "admin-1", 1)).toBeNull();
  });

  it("clears only the requested draft", () => {
    const storage = createStorage();
    storage.setItem("inbound", "draft");
    storage.setItem("other", "keep");

    clearSessionDraft(storage, "inbound");

    expect(storage.getItem("inbound")).toBeNull();
    expect(storage.getItem("other")).toBe("keep");
  });
});
