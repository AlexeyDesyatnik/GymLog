import { expect, test, type Page } from "@playwright/test";

/** Signs the app in with the test sign-in as this user and waits for its first sync. */
async function signIn(page: Page, name: string) {
  await page.goto("/");
  await page.getByLabel("Тестовый вход: имя пользователя").fill(name);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page.getByText("Синхронизировано с другими устройствами.")).toBeVisible();
}

test("Sets recorded on a phone offline reach the user's computer once the phone is back online", async ({
  page: phone,
  context: phoneContext,
  browser,
  baseURL,
}) => {
  // The server's database is shared by the run's tests, so each test is a user of its own.
  const user = `offline-${Date.now()}`;
  const computerContext = await browser.newContext({ baseURL });
  const computer = await computerContext.newPage();
  await signIn(phone, user);
  await signIn(computer, user);

  await phoneContext.setOffline(true);
  await phone.getByRole("button", { name: "Новая тренировка" }).click();
  await phone.getByRole("link", { name: /сегодня/ }).click();
  await phone.getByRole("button", { name: "Написать план" }).click();
  await phone.getByLabel("План: одна строка — одно упражнение").fill("squat 100x5x2");
  await phone.getByRole("button", { name: "Готово" }).click();
  await phone.getByRole("button", { name: "✓ Сделано" }).click();
  await expect(phone.getByRole("button", { name: /^Подход 1:/ })).toBeVisible();
  await phone.getByRole("button", { name: "✓ Сделано" }).click();
  await expect(phone.getByRole("button", { name: /^Подход 2:/ })).toBeVisible();
  await phone.getByRole("link", { name: "← Тренировки" }).click();
  await expect(phone.getByText("Не удалось синхронизировать.", { exact: false })).toBeVisible();

  await phoneContext.setOffline(false);

  // The computer looks for changes every few seconds.
  await computer.getByRole("link", { name: /сегодня/ }).click({ timeout: 15_000 });
  await expect(computer.getByRole("button", { name: /^Подход 2:/ })).toBeVisible();
  await expect(phone.getByText("Синхронизировано с другими устройствами.")).toBeVisible();
  await computerContext.close();
});
