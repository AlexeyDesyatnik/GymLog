import { expect, request, type Page } from "@playwright/test";

/** The run's Owner, who creates the Invites of its tests. */
const OWNER = { login: "the owner", password: "the owner's password" };

/**
 * A fresh Invite from the run's Owner, who becomes a User through the Owner's first Invite from
 * the global setup the first time, and signs in after that.
 */
async function inviteFromOwner(baseURL: string): Promise<string> {
  const owner = await request.newContext({ baseURL });
  try {
    const signedIn = async () => (await owner.post("/api/sign-in", { data: OWNER })).ok();
    const signedUp = async () =>
      (await owner.post("/api/sign-up", { data: { ...OWNER, invite: process.env.GYMLOG_E2E_OWNER_INVITE } })).ok();
    // A test running alongside may have just used the Owner's Invite up.
    expect((await signedIn()) || (await signedUp()) || (await signedIn())).toBe(true);
    const created = await owner.post("/api/invites", { data: {} });
    expect(created.ok()).toBe(true);
    return ((await created.json()) as { invite: string }).invite;
  } finally {
    await owner.dispose();
  }
}

/** A login nobody in the run has taken: the server's database is shared by the run's tests. */
export function newLogin(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** The password the tests give a login. */
function passwordOf(login: string): string {
  return `${login}'s password`;
}

/**
 * Opens a fresh Invite on this page and becomes a new User there with this Login, then waits for
 * the first sync.
 */
export async function signUp(page: Page, baseURL: string, login: string) {
  await page.goto(`/#/invite/${await inviteFromOwner(baseURL)}`);
  await expect(page.getByText("Вас пригласили в GymLog.", { exact: false })).toBeVisible();
  await page.getByLabel("Логин", { exact: true }).fill(login);
  await page.getByLabel("Пароль", { exact: true }).fill(passwordOf(login));
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await expect(page.getByText("Синхронизировано с другими устройствами.")).toBeVisible();
}

/** Opens the app on this page and signs in there with this login and its password, then waits for the first sync. */
export async function signIn(page: Page, login: string) {
  await page.goto("/");
  await page.getByLabel("Логин", { exact: true }).fill(login);
  await page.getByLabel("Пароль", { exact: true }).fill(passwordOf(login));
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page.getByText("Синхронизировано с другими устройствами.")).toBeVisible();
}
