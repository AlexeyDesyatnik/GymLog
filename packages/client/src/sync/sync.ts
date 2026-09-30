import {
  RECORD_TYPES,
  replacesKept,
  type PullAnswer,
  type PushAnswer,
  type RecordType,
  type SessionAnswer,
  type SyncedRecord,
} from "@gymlog/shared";
import { followMerges, mergeSameNames, recordTable, writeAsSync, type JournalDb, type Unsynced } from "../journal/store.ts";
import { serverApi, SignedOut } from "./api.ts";

/** Where this device stands with sync. */
export type SyncState =
  /** No server to sync with: the records stay on this device. */
  | { status: "off" }
  /** Whether anyone has signed in on this device isn't read from the store yet; it takes a moment. */
  | { status: "checking" }
  /** Nobody has ever signed in on this device, so the app asks to sign in before anything is recorded. */
  | { status: "neverSignedIn" }
  /** Not synced yet since the app opened. */
  | { status: "starting" }
  /** The user's session on this device has ended, so its records wait here until they sign in again. */
  | { status: "signedOut" }
  /** The last sync went through; the user signed in is the owner, or not. */
  | { status: "synced"; owner: boolean }
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
  /**
   * Syncs now: sends every change made here, then takes every change from elsewhere. Rejects when it
   * fails. Once sync has stopped, with the store closed for good, it does nothing.
   */
  now(): Promise<void>;
}

export interface SyncOptions {
  /** The server's address; empty for the server the app itself came from. */
  url: string;
  /** For tests, a fetch with a cookie jar of its own. */
  fetch?: typeof fetch;
  /**
   * Calls the listener whenever the device comes back online; returns a function that stops it.
   * The browser's `online` event by default; tests pass their own.
   */
  onOnline?: (listener: () => void) => () => void;
  /** How long a request may go unanswered before it counts as failed; for tests, shorter than the default. */
  timeoutMs?: number;
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

/** Syncs the store with the server in the options, if any; the clock stamps the changes sync itself makes. */
export function openSync(db: JournalDb, options: SyncOptions | undefined, clock: () => number): SyncControl {
  let state: SyncState = options ? { status: "checking" } : { status: "off" };
  const stateListeners = new Set<() => void>();
  const arrivalListeners = new Set<() => void>();
  let closed = false;
  let changeTimer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let stopWatchingConnection: (() => void) | undefined;
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

  const api = options && serverApi(options);

  /** One sync: whose records these are, then send, then take. */
  async function round(): Promise<void> {
    if (closed) return;
    try {
      const { userId, owner } = await api!<SessionAnswer>("/api/session");
      if ((await claim(userId)) !== userId) return setState({ status: "otherUser" });
      await push(userId);
      await pull(userId);
      // Exercises of one Primary name made on two devices become one, and an Entry that arrived on an
      // Exercise merged away moves to where it was merged; that goes out at once. Every round
      // checks, so Exercises of one Primary name synced before the check existed become one too.
      const merged = await mergeSameNames(db, clock());
      if ((await followMerges(db)) || merged) await push(userId);
      setState({ status: "synced", owner });
    } catch (error) {
      // A device nobody has signed in on waits for its first sign-in, reachable or not. A store
      // that can't say leaves the app as it is: the store's own state tells of that.
      if (!(await signedInBefore().catch(() => true))) setState({ status: "neverSignedIn" });
      else if (error instanceof SignedOut) setState({ status: "signedOut" });
      else setState({ status: "failed", error: String(error) });
      if (!(error instanceof SignedOut)) throw error;
    }
  }

  /** Someone has signed in on this device: its records belong to them. */
  async function signedInBefore(): Promise<boolean> {
    return (await db.syncProgress.get("sync")) !== undefined;
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
      const { refused } = await api!<PushAnswer>("/api/sync/push", { records: wire });
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
      const page = await api!<PullAnswer>(`/api/sync/pull?after=${progress.cursor}`);
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
    if (state.status === "neverSignedIn" || state.status === "signedOut" || state.status === "otherUser") return;
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
    start() {
      if (!options || closed) return;
      // Read at once, so the app can ask for the first sign-in without waiting for the server.
      void signedInBefore().then(
        (before) => {
          if (state.status === "checking") setState({ status: before ? "starting" : "neverSignedIn" });
        },
        () => {},
      );
      syncSoon();
      pollTimer = setInterval(poll, POLL_MS);
      if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
      // What was changed offline goes as soon as the connection is back, not at the next poll.
      stopWatchingConnection = (options.onOnline ?? onBrowserOnline)(poll);
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
      stopWatchingConnection?.();
    },
  };
}

/** The browser's word that the device is back online; nothing outside a browser. */
function onBrowserOnline(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("online", listener);
  return () => window.removeEventListener("online", listener);
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

