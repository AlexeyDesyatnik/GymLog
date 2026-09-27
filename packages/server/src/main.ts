import { startServer } from "./server.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set");
const testSignIn = process.env.GYMLOG_TEST_SIGN_IN === "1";
if (testSignIn && process.env.NODE_ENV === "production") {
  throw new Error("The test sign-in lets anyone sign in as anyone; it is never turned on in production");
}

const server = await startServer({
  databaseUrl,
  // Names of the server's own, since the dev tools set PORT for the client's dev server.
  host: process.env.SERVER_HOST ?? "127.0.0.1",
  port: Number(process.env.SERVER_PORT ?? 3000),
  testSignIn,
});
console.log(`GymLog server at ${server.url}${testSignIn ? ", with the test sign-in" : ""}`);
