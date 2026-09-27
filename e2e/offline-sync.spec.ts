import { expect, test } from "@playwright/test";
import { newLogin, signIn, signUp } from "./signIn.ts";

test("Sets recorded on a phone offline reach the user's computer once the phone is back online", async ({
  page: phone,
  context: phoneContext,
  browser,
  baseURL,
}) => {
  const user = newLogin("offline");
  const computerContext = await browser.newContext({ baseURL });
  const computer = await computerContext.newPage();
  await signUp(phone, baseURL!, user);
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
