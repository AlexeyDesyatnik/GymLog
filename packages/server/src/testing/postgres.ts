import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";
import { APP_ROLE, ensureAppRole, handDatabaseToApp } from "../database-role.ts";

/** The same image and version as the dev database in compose.yaml and the server's. */
export const POSTGRES_IMAGE = "postgres:18-alpine";

declare module "vitest" {
  export interface ProvidedContext {
    /** Connects to the test run's PostgreSQL as the superuser, who may create databases. */
    postgresUrl: string;
  }
}

/** A clean PostgreSQL in Docker, for one test run, where the app's role is already made. */
export interface TestPostgres {
  /** Connects as the superuser, who may create databases and hand them to the app's role. */
  url: string;
  stop(): Promise<void>;
}

/**
 * Starts a clean PostgreSQL in Docker. Its data lives in memory: nothing of a test run needs to
 * survive it, and on Docker Desktop a write to disk now and then takes seconds, long enough for
 * tests to time out.
 */
export async function startTestPostgres(): Promise<TestPostgres> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withTmpFs({ "/var/lib/postgresql": "rw" })
    .start();
  const url = new URL(container.getConnectionUri());
  // Over IPv4, as the dev database: Node tries localhost's IPv6 address first, and Docker
  // Desktop at times stops answering there, which costs each new connection a quarter of a
  // second, or fails it.
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  await ensureAppRole(url.href, TEST_APP_PASSWORD);
  return { url: url.href, stop: async () => void (await container.stop()) };
}

/** The password of the app's role in tests. */
const TEST_APP_PASSWORD = "the app's password";

/**
 * Hands the database this superuser's URL connects to over to the app's role, as deploys do;
 * returns how the app connects to it, as the server does in production.
 */
export async function handToApp(superuserUrl: string): Promise<string> {
  await handDatabaseToApp(superuserUrl);
  const url = new URL(superuserUrl);
  url.username = APP_ROLE;
  url.password = TEST_APP_PASSWORD;
  return url.href;
}

let postgres: TestPostgres | undefined;

/** Starts one clean PostgreSQL for the whole test run; each test then gets a database of its own. */
export async function setup(project: TestProject): Promise<void> {
  postgres = await startTestPostgres();
  project.provide("postgresUrl", postgres.url);
}

export async function teardown(): Promise<void> {
  await postgres?.stop();
}
