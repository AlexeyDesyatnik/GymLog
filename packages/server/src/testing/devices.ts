import { inject, onTestFinished } from "vitest";
import pg from "pg";
import type { PushAnswer, SyncRecord } from "@gymlog/shared";
import { openJournal, type Journal } from "@gymlog/client/journal";
import { uniqueJournalName } from "@gymlog/client/testing";
import { startServer } from "../server.ts";

/** The real server on a database of its own, with the test sign-in. */
export interface TestServer {
  url: string;
  /**
   * A new device syncing with this server, not signed in yet; its local store is empty, or
   * the one of this name when given.
   */
  device(store?: string): Device;
}

/** One browser: a Journal on its own local store and a cookie jar of its own. */
export interface Device {
  journal: Journal;
  /** Signs this device in with the test sign-in, as the user of this name, and syncs. */
  signIn(name: string): Promise<void>;
  /** Requests to the server as this device, carrying its session cookie. */
  fetch: typeof fetch;
  /** The server gets this device's next request, but its answer is lost on the way back. */
  loseNextAnswer(): void;
  /** Takes this device offline: its requests fail until it goes online again. */
  goOffline(): void;
  goOnline(): void;
  /** Sets this device's clock to this time, in milliseconds; it ticks by 1 ms per reading from there. */
  setClock(time: number): void;
  /** Closes the app on this device and opens it again, still signed in. */
  reopen(): Device;
}

let databaseCount = 0;

/** Starts the server on a fresh database; it stops, with its devices, when the test ends. */
export async function startTestServer(): Promise<TestServer> {
  const databaseUrl = await createDatabase();
  const server = await startServer({ databaseUrl, host: "127.0.0.1", port: 0, testSignIn: true });
  onTestFinished(() => server.close());

  /** A browser with this local store, cookie jar and clock, where the app has just opened. */
  function openDevice(store: string, jarFetch: typeof fetch, clock: Clock): Device {
    let losingAnswer = false;
    let offline = false;
    const deviceFetch: typeof fetch = async (input, init) => {
      if (offline) throw new TypeError("fetch failed: offline");
      const response = await jarFetch(input, init);
      if (!losingAnswer) return response;
      losingAnswer = false;
      throw new TypeError("fetch failed: the answer was lost");
    };
    const journal = openJournal({ name: store, now: clock.read, server: { url: server.url, fetch: deviceFetch } });
    onTestFinished(() => journal.close());
    return {
      journal,
      signIn: (name) => journal.sync.testSignIn(name),
      fetch: deviceFetch,
      loseNextAnswer: () => (losingAnswer = true),
      goOffline: () => (offline = true),
      goOnline: () => (offline = false),
      setClock: clock.set,
      reopen: () => {
        journal.close();
        return openDevice(store, jarFetch, clock);
      },
    };
  }

  return {
    url: server.url,
    device(store = uniqueJournalName()) {
      return openDevice(store, cookieJarFetch(), tickingClock());
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

/** fetch that keeps the cookies the server sets and sends them back, as a browser does. */
function cookieJarFetch(): typeof fetch {
  const cookies = new Map<string, string>();
  return async (input, init) => {
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
