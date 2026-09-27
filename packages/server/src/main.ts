import { startServer } from "./server.ts";
import type { VkIdOptions } from "./vk-id.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set");
const development = process.env.NODE_ENV === "development";
const testSignIn = process.env.GYMLOG_TEST_SIGN_IN === "1";
// Only where development is declared outright, so a deploy that forgets NODE_ENV can't turn it on.
if (testSignIn && !development) {
  throw new Error("The test sign-in lets anyone sign in as anyone; it is only for NODE_ENV=development");
}
const vkId = vkIdOptions();
// Outside development, VK ID is the only way in.
if (!vkId && !development) throw new Error("VK_ID_CLIENT_ID and VK_ID_REDIRECT_URL are not set");

const server = await startServer({
  databaseUrl,
  // Names of the server's own, since the dev tools set PORT for the client's dev server.
  host: process.env.SERVER_HOST ?? "127.0.0.1",
  port: Number(process.env.SERVER_PORT ?? 3000),
  testSignIn,
  vkId,
});
const signIns = [vkId && "VK ID", testSignIn && "the test sign-in"].filter(Boolean).join(" and ") || "no sign-in";
console.log(`GymLog server at ${server.url}, with ${signIns}`);

/** The app's registration with VK ID, when both of its settings are given. */
function vkIdOptions(): VkIdOptions | null {
  const clientId = process.env.VK_ID_CLIENT_ID;
  const redirectUrl = process.env.VK_ID_REDIRECT_URL;
  if (!clientId && !redirectUrl) return null;
  if (!clientId || !redirectUrl) throw new Error("VK ID needs both VK_ID_CLIENT_ID and VK_ID_REDIRECT_URL");
  return { clientId, redirectUrl };
}
