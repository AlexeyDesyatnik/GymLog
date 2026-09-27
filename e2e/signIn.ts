import { expect, request, type Page } from "@playwright/test";

/**
 * A fresh Invite from the run's owner, who signs in through the owner's first Invite from
 * the global setup the first time and is known after that.
 */
async function inviteFromOwner(baseURL: string): Promise<string> {
  const owner = await request.newContext({ baseURL });
  try {
    const signIn = await owner.post("/api/test-sign-in", {
      data: { name: "the owner", invite: process.env.GYMLOG_E2E_OWNER_INVITE },
    });
    expect(signIn.ok()).toBe(true);
    const created = await owner.post("/api/invites", { data: {} });
    expect(created.ok()).toBe(true);
    return ((await created.json()) as { invite: string }).invite;
  } finally {
    await owner.dispose();
  }
}

/** A name nobody in the run has signed in with: the server's database is shared by the run's tests. */
export function newUserName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Opens the app on this page through a fresh Invite and signs in there with the test sign-in
 * as a new user of this name, then waits for the first sync.
 */
export async function signUp(page: Page, baseURL: string, name: string) {
  await page.goto(`/#/invite/${await inviteFromOwner(baseURL)}`);
  await expect(page.getByText("Вас пригласили в GymLog.", { exact: false })).toBeVisible();
  await signInOnScreen(page, name);
}

/** Opens the app on this page and signs in there with the test sign-in as this user, then waits for the first sync. */
export async function signIn(page: Page, name: string) {
  await page.goto("/");
  await signInOnScreen(page, name);
}

async function signInOnScreen(page: Page, name: string) {
  await page.getByLabel("Тестовый вход: имя пользователя").fill(name);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page.getByText("Синхронизировано с другими устройствами.")).toBeVisible();
}
