import { inject, onTestFinished } from "vitest";
import pg from "pg";
import type { PushAnswer, SyncRecord } from "@gymlog/shared";
import { openJournal, type Journal } from "@gymlog/client/journal";
import { uniqueJournalName } from "@gymlog/client/testing";
import { createOwnerInvite, createOwnerResetLink, openDatabase } from "../users.ts";
import { startServer } from "../server.ts";
import { handToApp } from "./postgres.ts";

/** The database as a backup took it: a copy no server connects to. */
export interface Dump {
  superuserUrl: string;
}

/** The real server on a database of its own. */
export interface TestServer {
  url: string;
  /** What the server connects to its database with now. */
  readonly databaseUrl: string;
  /**
   * A new device syncing with this server, not signed in yet; its local store is empty, or
   * the one of this name when given.
   */
  device(store?: string): Device;
  /** The owner's own first Invite, as the server command that sets GymLog up gives it. */
  ownerInvite(): Promise<string>;
  /** A Reset link for the Owner, as the server command gives it. */
  ownerResetLink(): Promise<string>;
  /** A fresh Invite from the test's Owner, who becomes a User the first time. */
  inviteFromOwner(): Promise<string>;
  /**
   * Hands the database, with all it holds, to the app's role, as every deploy does since #39,
   * and starts the server on it again, connected as the app's role, at the same address: its
   * devices go on syncing with it.
   */
  handDatabaseToApp(): Promise<void>;
  /** A dump of the database as it is now, as the nightly backup takes; the server stops for a moment to take it. */
  dump(): Promise<Dump>;
  /**
   * Replaces the database with the dump, as `deploy/prod.sh restore` does: a database made anew
   * from it, handed to the app's role, and the server started on it again at the same address.
   * Its devices keep what they hold and go on syncing with it.
   */
  restore(dump: Dump): Promise<void>;
}

/** One browser: a Journal on its own local store and a cookie jar of its own. */
export interface Device {
  journal: Journal;
  /** Signs this device in with this login and its test password (see testPassword), or the password given. */
  signIn(login: string, password?: string): Promise<void>;
  /**
   * Becomes a new User with this Login and its test password, or the password given, through
   * this Invite, or a fresh one from the test's Owner, and signs this device in.
   */
  signUp(login: string, options?: { invite?: string; password?: string }): Promise<void>;
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
  /** How many requests this device has sent to the server, answered or not. */
  requestsSent(): number;
  /** How many records this device has sent to the server in its pushes, answered or not. */
  recordsPushed(): number;
  /** Sets this device's clock to this time, in milliseconds; it ticks by 1 ms per reading from there. */
  setClock(time: number): void;
  /** Closes the app on this device and opens it again, still signed in and on the same connection. */
  reopen(): Device;
}

/** How long a device waits for an answer before it gives the request up; short, so tests of a stalled one are quick. */
const DEVICE_TIMEOUT_MS = 2_000;

let databaseCount = 0;

/**
 * Starts the server on a fresh database; it stops, with its devices, when the test ends. It
 * connects as the app's role, as in production, or as the superuser, as it did before #39.
 */
export async function startTestServer({
  connectAs = "app",
}: { connectAs?: "app" | "superuser" } = {}): Promise<TestServer> {
  let current = await serveDatabase(await createDatabase(), connectAs, 0);
  const url = current.server.url;
  const port = Number(new URL(url).port);
  onTestFinished(() => current.stop());

  /** Stops the server and starts it again at the same address, on the database this superuser's URL connects to. */
  async function serveAgain(superuserUrl: string, as: "app" | "superuser") {
    await current.stop();
    current = await serveDatabase(superuserUrl, as, port);
  }

  const ownerInvite = () => createOwnerInvite(current.database.db);
  /** The owner who invites the users of the test; signed in on a device of their own once needed. */
  let owner: Promise<Device> | undefined;
  async function inviteFromOwner(): Promise<string> {
    owner ??= (async () => {
      const ownersDevice = openDevice(uniqueJournalName(), deviceConnection(), tickingClock());
      await ownersDevice.signUp("the owner", { invite: await ownerInvite() });
      return ownersDevice;
    })();
    return (await owner).journal.access.createInvite();
  }

  /** A browser with this local store, connection and clock, where the app has just opened. */
  function openDevice(store: string, connection: Connection, clock: Clock): Device {
    const journal = openJournal({
      name: store,
      now: clock.read,
      server: {
        url,
        fetch: connection.fetch,
        onOnline: connection.onOnline,
        timeoutMs: DEVICE_TIMEOUT_MS,
      },
    });
    onTestFinished(() => journal.close());
    return {
      ...connection.control,
      journal,
      signIn: (login, password = testPassword(login)) => journal.access.signIn(login, password),
      signUp: async (login, { invite, password = testPassword(login) } = {}) =>
        journal.access.signUp(invite ?? (await inviteFromOwner()), login, password),
      fetch: connection.fetch,
      setClock: clock.set,
      reopen: () => {
        journal.close();
        return openDevice(store, connection, clock);
      },
    };
  }

  return {
    url,
    get databaseUrl() {
      return current.databaseUrl;
    },
    device(store = uniqueJournalName()) {
      return openDevice(store, deviceConnection(), tickingClock());
    },
    ownerInvite,
    ownerResetLink: () => createOwnerResetLink(current.database.db),
    inviteFromOwner,
    handDatabaseToApp: () => serveAgain(current.superuserUrl, "app"),
    async dump() {
      const live = current;
      // A database can be copied only while nobody is connected to it.
      await live.stop();
      const dump = { superuserUrl: await createDatabase(live.superuserUrl) };
      current = await serveDatabase(live.superuserUrl, live.connectAs, port);
      return dump;
    },
    restore: async (dump) => serveAgain(await createDatabase(dump.superuserUrl), current.connectAs),
  };
}

/**
 * The server, and the test's own connection, on the database this superuser's URL connects to,
 * connected as the app's role, to which the database is handed first, or as the superuser.
 */
async function serveDatabase(superuserUrl: string, connectAs: "app" | "superuser", port: number) {
  const databaseUrl = connectAs === "app" ? await handToApp(superuserUrl) : superuserUrl;
  const server = await startServer({ databaseUrl, host: "127.0.0.1", port });
  const database = await openDatabase(databaseUrl);
  return {
    server,
    database,
    databaseUrl,
    superuserUrl,
    connectAs,
    stop: once(async () => {
      await server.close();
      await database.close();
    }),
  };
}

/** Runs this the first time only; later calls get the same promise. */
function once(run: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | undefined;
  return () => (running ??= run());
}

/** The password tests give a login unless they choose one. */
export function testPassword(login: string): string {
  return `${login.trim()}'s password`;
}

type ConnectionControl = Pick<
  Device,
  | "loseNextAnswer"
  | "dropConnectionMidPush"
  | "stallNextRequest"
  | "goOffline"
  | "goOnline"
  | "expireSession"
  | "requestsSent"
  | "recordsPushed"
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
  let requestsSent = 0;
  let recordsPushed = 0;

  const connectionFetch: typeof fetch = async (input, init) => {
    requestsSent++;
    const pushing = String(input).includes("/api/sync/push");
    if (pushing) recordsPushed += (JSON.parse(String(init?.body)) as { records: unknown[] }).records.length;
    if (offline) throw new TypeError("fetch failed: offline");
    if (stalling) {
      stalling = false;
      // Never answered; only the device giving up ends it.
      return new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      });
    }
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
      requestsSent: () => requestsSent,
      recordsPushed: () => recordsPushed,
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

/**
 * A new database in the test run's PostgreSQL, empty or a copy of the one this superuser's URL
 * connects to, which nobody may be connected to; returns how the superuser connects to it.
 */
async function createDatabase(copyOf?: string): Promise<string> {
  const url = new URL(inject("postgresUrl"));
  const name = `test_${process.pid}_${++databaseCount}`;
  const admin = new pg.Client({ connectionString: url.href });
  await admin.connect();
  try {
    const template = copyOf ? ` TEMPLATE ${new URL(copyOf).pathname.slice(1)}` : "";
    await admin.query(`CREATE DATABASE ${name}${template}`);
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
