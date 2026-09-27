import {
  RECORD_TYPES,
  replacesKept,
  type PullAnswer,
  type PushAnswer,
  type RecordType,
  type SyncedRecord,
} from "@gymlog/shared";
import { recordTable, writeAsSync, type JournalDb, type Unsynced } from "../journal/store.ts";

/** Where this device stands with sync. */
export type SyncState =
  /** No server to sync with: the records stay on this device. */
  | { status: "off" }
  /** Not synced yet since the app opened. */
  | { status: "starting" }
  /** Nobody is signed in on this device, so its records wait here. */
  | { status: "signedOut" }
  /** The last sync went through. */
  | { status: "synced" }
  /** The records on this device belong to another user than the one signed in, so nothing is synced. */
  | { status: "otherUser" }
  /** The last sync failed, e.g. with no connection; the records wait on this device. */
  | { status: "failed"; error: string };

/**
 * Keeps this device's records and the server's in step: sends the changes made here and
 * takes those made on the user's other devices.
 */
export interface Sync {
  state(): SyncState;
  /** Calls the listener on every change of the state; returns a function that stops it. */
  onStateChange(listener: () => void): () => void;
  /** Calls the listener whenever records from another device are stored here; returns a function that stops it. */
  onRecordsArrived(listener: () => void): () => void;
  /** Syncs now: sends every change made here, then takes every change from elsewhere. Rejects when it fails. */
  now(): Promise<void>;
  /** Signs this device in by name alone, then syncs. Only the dev and test server allows it. */
  testSignIn(name: string): Promise<void>;
}

export interface SyncOptions {
  /** The server's address; empty for the server the app itself came from. */
  url: string;
  /** For tests, a fetch with a cookie jar of its own. */
  fetch?: typeof fetch;
}

/** The Journal's side of sync: it says when the store is ready and when something changed. */
export interface SyncControl extends Sync {
  start(): void;
  changed(): void;
  close(): void;
}

/** How soon after a change it is sent. */
const CHANGE_DELAY_MS = 1000;
/** How often, while the app is in view, changes from other devices are looked for. */
const POLL_MS = 5000;
/** The most records sent in one request; the server takes up to 500. */
const PUSH_BATCH = 200;
/** Sending stops for this round after this many batches, so constant typing can't keep it going forever. */
const MAX_PUSH_BATCHES = 50;

/** The server refused the session: nobody is signed in on this device. */
class SignedOut extends Error {}

export function openSync(db: JournalDb, options: SyncOptions | undefined): SyncControl {
  let state: SyncState = options ? { status: "starting" } : { status: "off" };
  const stateListeners = new Set<() => void>();
  const arrivalListeners = new Set<() => void>();
  let closed = false;
  let changeTimer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  /** Looks for changes from other devices as soon as the app is back in view. */
  const onVisible = () => {
    if (document.visibilityState === "visible") poll();
  };
  /** The round last started or waiting to start, and the one waiting, if any. */
  let latest: Promise<void> = Promise.resolve();
  let waiting: Promise<void> | null = null;

  function setState(next: SyncState) {
    if (JSON.stringify(next) === JSON.stringify(state)) return;
    state = next;
    for (const listener of stateListeners) listener();
  }

  async function api<T>(path: string, body?: unknown): Promise<T> {
    const request = options!.fetch ?? fetch;
    const response = await request(`${options!.url}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 401) throw new SignedOut();
    if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
    return (await response.json()) as T;
  }

  /** One sync: whose records these are, then send, then take. */
  async function round(): Promise<void> {
    if (closed) return;
    try {
      const { userId } = await api<{ userId: string }>("/api/session");
      if ((await claim(userId)) !== userId) return setState({ status: "otherUser" });
      await push(userId);
      await pull(userId);
      setState({ status: "synced" });
    } catch (error) {
      if (error instanceof SignedOut) return setState({ status: "signedOut" });
      setState({ status: "failed", error: String(error) });
      throw error;
    }
  }

  /** The owner of this device's records; the first user to sign in here becomes it, with every record made before. */
  async function claim(userId: string): Promise<string> {
    return writeAsSync(db, async () => {
      const progress = await db.syncProgress.get("sync");
      if (progress) return progress.ownerId;
      await db.syncProgress.put({ key: "sync", ownerId: userId, cursor: 0 });
      return userId;
    });
  }

  async function push(userId: string): Promise<void> {
    for (let batch = 0; batch < MAX_PUSH_BATCHES; batch++) {
      const sending = await unsyncedRecords();
      if (sending.length === 0) return;
      const wire = sending.map(({ type, record }) => ({ ...withoutMark(record), type, ownerId: userId }));
      const { refused } = await api<PushAnswer>("/api/sync/push", { records: wire });
      for (const refusal of refused) console.warn("The server refused a record", refusal);
      const refusedIds = new Set(refused.map((r) => r.id));
      await writeAsSync(db, async () => {
        for (const { type, record } of sending) {
          const table = recordTable(db, type);
          const current = await table.get(record.id);
          // A record changed again while it was being sent still has that change to send.
          if (!current || !sameRecord(current, record)) continue;
          // A refused record would be refused again as it is; it goes again once it changes.
          await table.update(record.id, { unsynced: refusedIds.has(record.id) ? 2 : 0 });
        }
      });
    }
  }

  async function unsyncedRecords(): Promise<{ type: RecordType; record: SyncedRecord & Unsynced }[]> {
    const found: { type: RecordType; record: SyncedRecord & Unsynced }[] = [];
    for (const type of RECORD_TYPES) {
      const records = await recordTable(db, type)
        .where("unsynced")
        .equals(1)
        .limit(PUSH_BATCH - found.length)
        .toArray();
      found.push(...records.map((record) => ({ type, record })));
      if (found.length >= PUSH_BATCH) break;
    }
    return found;
  }

  async function pull(userId: string): Promise<void> {
    for (;;) {
      const progress = (await db.syncProgress.get("sync"))!;
      const page = await api<PullAnswer>(`/api/sync/pull?after=${progress.cursor}`);
      const arrived = await writeAsSync(db, async () => {
        let stored = false;
        for (const { type, ownerId, ...record } of page.records) {
          if (ownerId !== userId || !RECORD_TYPES.includes(type)) continue;
          const table = recordTable(db, type);
          const current = await table.get(record.id);
          // A change made here and not sent yet goes to the server next; it stays if it will replace this one there.
          if (current?.unsynced === 1 && replacesKept(current, record)) continue;
          if (current && sameRecord(current, record)) continue;
          await table.put({ ...record, unsynced: 0 });
          stored = true;
        }
        await db.syncProgress.update("sync", { cursor: page.cursor });
        return stored;
      });
      if (arrived) for (const listener of arrivalListeners) listener();
      if (!page.more) return;
    }
  }

  function now(): Promise<void> {
    if (!options) return Promise.resolve();
    // A round already waiting to start will see everything changed before it starts.
    if (waiting) return waiting;
    const next = latest
      .catch(() => {})
      .then(() => {
        waiting = null;
        return round();
      });
    waiting = next;
    latest = next;
    return next;
  }

  /** Syncs in the background; a failure only shows in the state. */
  function syncSoon() {
    now().catch(() => {});
  }

  /** Looks for changes from other devices, while the app is in view and someone is signed in. */
  function poll() {
    // Signing in syncs by itself; until then there is nothing to look for.
    if (state.status === "signedOut" || state.status === "otherUser") return;
    if (typeof document === "undefined" || document.visibilityState === "visible") syncSoon();
  }

  return {
    state: () => state,
    onStateChange(listener) {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
    onRecordsArrived(listener) {
      arrivalListeners.add(listener);
      return () => arrivalListeners.delete(listener);
    },
    now,
    async testSignIn(name) {
      if (!options) throw new Error("There is no server to sign in to");
      await api("/api/test-sign-in", { name });
      await now();
    },
    start() {
      if (!options || closed) return;
      syncSoon();
      pollTimer = setInterval(poll, POLL_MS);
      if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
    },
    changed() {
      if (!options || closed) return;
      clearTimeout(changeTimer);
      changeTimer = setTimeout(syncSoon, CHANGE_DELAY_MS);
    },
    close() {
      closed = true;
      clearTimeout(changeTimer);
      clearInterval(pollTimer);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
    },
  };
}

function withoutMark(record: SyncedRecord & Unsynced): SyncedRecord {
  const { unsynced: _, ...rest } = record;
  return rest;
}

/** The same record fields, whatever their order; a missing field and an undefined one are the same. */
function sameRecord(a: object, b: object): boolean {
  return sameValue(withoutMark(a as SyncedRecord), withoutMark(b as SyncedRecord));
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}
