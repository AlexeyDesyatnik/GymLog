import { inject, onTestFinished } from "vitest";
import pg from "pg";
import type { PushAnswer, SyncRecord } from "@gymlog/shared";
import { openJournal, type Journal } from "@gymlog/client/journal";
import { uniqueJournalName } from "@gymlog/client/testing";
import { createOwnerInvite, openDatabase } from "../accounts.ts";
import { startServer } from "../server.ts";

/** The real server on a database of its own, with the test sign-in. */
export interface TestServer {
  url: string;
  /**
   * A new device syncing with this server, not signed in yet; its local store is empty, or
   * the one of this name when given.
   */
  device(store?: string): Device;
  /** The owner's own first Invite, as the server command that sets GymLog up gives it. */
  ownerInvite(): Promise<string>;
}

/** One browser: a Journal on its own local store and a cookie jar of its own. */
export interface Device {
  journal: Journal;
  /**
   * Signs this device in with the test sign-in in place of VK ID, as the person of this name,
   * through this Invite if given, and syncs.
   */
  signIn(name: string, invite?: string): Promise<void>;
  /**
   * Signs this device in as a new user of this name, who gets an account through a fresh
   * Invite from the owner, and syncs.
   */
  signUp(name: string): Promise<void>;
  /** Requests to the server as this device, carrying its session cookie. */
  fetch: typeof fetch;
  /** The server gets this device's next request, but its answer is lost on the way back. */
  loseNextAnswer(): void;
  /**
   * The connection drops in the middle of this device's next push: its first request reaches
   * the server, the answer is lost, and the device is offline from then on.
   */
  dropConnectionMidPush(): void;
  /** This device's next request never gets an answer, as on a connection that stalls. */
  stallNextRequest(): void;
  /** Takes this device offline: its requests fail until it goes online again. */
  goOffline(): void;
  /** Brings this device back online; the device hears that its connection is back. */
  goOnline(): void;
  /** The session on this device expires: the server no longer knows who is signed in there. */
  expireSession(): void;
  /** Sets this device's clock to this time, in milliseconds; it ticks by 1 ms per reading from there. */
  setClock(time: number): void;
  /** Closes the app on this device and opens it again, still signed in and on the same connection. */
  reopen(): Device;
}

/** How long a device waits for an answer before it gives the request up; short, so tests of a stalled one are quick. */
const DEVICE_TIMEOUT_MS = 2_000;

let databaseCount = 0;

/** Starts the server on a fresh database; it stops, with its devices, when the test ends. */
export async function startTestServer(): Promise<TestServer> {
  const databaseUrl = await createDatabase();
  const server = await startServer({ databaseUrl, host: "127.0.0.1", port: 0, testSignIn: true, vkId: null });
  onTestFinished(() => server.close());
  const database = await openDatabase(databaseUrl);
  onTestFinished(() => database.close());
  const ownerInvite = () => createOwnerInvite(database.db);
  /** The owner who invites the users of the test; signed in on a device of their own once needed. */
  let owner: Promise<Device> | undefined;
  async function inviteFromOwner(): Promise<string> {
    owner ??= (async () => {
      const ownersDevice = openDevice(uniqueJournalName(), deviceConnection(), tickingClock());
      await ownersDevice.signIn("the owner", await ownerInvite());
      return ownersDevice;
    })();
    return (await owner).journal.sync.createInvite();
  }

  /** A browser with this local store, connection and clock, where the app has just opened. */
  function openDevice(store: string, connection: Connection, clock: Clock): Device {
    const journal = openJournal({
      name: store,
      now: clock.read,
      server: {
        url: server.url,
        fetch: connection.fetch,
        onOnline: connection.onOnline,
        timeoutMs: DEVICE_TIMEOUT_MS,
      },
    });
    onTestFinished(() => journal.close());
    return {
      ...connection.control,
      journal,
      signIn: (name, invite) => journal.sync.testSignIn(name, invite),
      signUp: async (name) => journal.sync.testSignIn(name, await inviteFromOwner()),
      fetch: connection.fetch,
      setClock: clock.set,
      reopen: () => {
        journal.close();
        return openDevice(store, connection, clock);
      },
    };
  }

  return {
    url: server.url,
    device(store = uniqueJournalName()) {
      return openDevice(store, deviceConnection(), tickingClock());
    },
    ownerInvite,
  };
}

type ConnectionControl = Pick<
  Device,
  "loseNextAnswer" | "dropConnectionMidPush" | "stallNextRequest" | "goOffline" | "goOnline" | "expireSession"
>;

/** A device's network and cookies: what stays the same when the app is closed and opened again. */
interface Connection {
  fetch: typeof fetch;
  /** Calls the listener whenever the device comes back online; returns a function that stops it. */
  onOnline(listener: () => void): () => void;
  control: ConnectionControl;
}

function deviceConnection(): Connection {
  const jar = cookieJar();
  let offline = false;
  let losingAnswer = false;
  let droppingMidPush = false;
  let stalling = false;
  const onlineListeners = new Set<() => void>();

  const connectionFetch: typeof fetch = async (input, init) => {
    if (offline) throw new TypeError("fetch failed: offline");
    if (stalling) {
      stalling = false;
      // Never answered; only the device giving up ends it.
      return new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      });
    }
    const pushing = String(input).includes("/api/sync/push");
    const response = await jar.fetch(input, init);
    if (droppingMidPush && pushing) {
      droppingMidPush = false;
      offline = true;
      throw new TypeError("fetch failed: the connection dropped");
    }
    if (!losingAnswer) return response;
    losingAnswer = false;
    throw new TypeError("fetch failed: the answer was lost");
  };

  return {
    fetch: connectionFetch,
    onOnline(listener) {
      onlineListeners.add(listener);
      return () => onlineListeners.delete(listener);
    },
    control: {
      loseNextAnswer: () => (losingAnswer = true),
      dropConnectionMidPush: () => (droppingMidPush = true),
      stallNextRequest: () => (stalling = true),
      goOffline: () => (offline = true),
      goOnline: () => {
        offline = false;
        for (const listener of onlineListeners) listener();
      },
      expireSession: jar.clear,
    },
  };
}

interface Clock {
  read(): number;
  set(time: number): void;
}

/** A device clock that ticks by 1 ms per reading. */
function tickingClock(): Clock {
  let time = 1_000;
  return {
    read: () => time++,
    set: (next) => (time = next),
  };
}

/** A new, empty database in the test run's PostgreSQL. */
async function createDatabase(): Promise<string> {
  const url = new URL(inject("postgresUrl"));
  const name = `test_${process.pid}_${++databaseCount}`;
  const admin = new pg.Client({ connectionString: url.href });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  url.pathname = `/${name}`;
  return url.href;
}

/** fetch that keeps the cookies the server sets and sends them back, as a browser does; clear forgets them. */
function cookieJar(): { fetch: typeof fetch; clear(): void } {
  const cookies = new Map<string, string>();
  const jarFetch: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    if (cookies.size > 0) headers.set("cookie", [...cookies].map(([name, value]) => `${name}=${value}`).join("; "));
    const response = await fetch(input, { ...init, headers });
    for (const setCookie of response.headers.getSetCookie()) {
      const [pair = ""] = setCookie.split(";");
      const at = pair.indexOf("=");
      cookies.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
    }
    return response;
  };
  return { fetch: jarFetch, clear: () => cookies.clear() };
}

/** Sends records to the server as this device, the way a client of any make could. */
export async function pushAs(
  device: Device,
  url: string,
  records: unknown[],
): Promise<{ status: number; answer: PushAnswer }> {
  const response = await device.fetch(`${url}/api/sync/push`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ records }),
  });
  return { status: response.status, answer: (await response.json()) as PushAnswer };
}

/**
 * The records the server gives this device after the cursor, from the start by default, the
 * way a client of any make could ask.
 */
export async function pullAs(
  device: Device,
  url: string,
  after = 0,
): Promise<{ status: number; records: SyncRecord[]; cursor?: number }> {
  const response = await device.fetch(`${url}/api/sync/pull?after=${after}`);
  const body = (await response.json()) as { records?: SyncRecord[]; cursor?: number };
  return { status: response.status, records: body.records ?? [], cursor: body.cursor };
}

/** The id of the user signed in on this device. */
export async function userIdOf(device: Device, url: string): Promise<string> {
  const response = await device.fetch(`${url}/api/session`);
  return ((await response.json()) as { userId: string }).userId;
}
