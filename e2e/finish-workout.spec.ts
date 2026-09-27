import { expect, test } from "@playwright/test";
import { newUserName, signUp } from "./signIn.ts";

test("plan a Workout, confirm Sets and Finish it: what wasn't recorded is Not performed", async ({ page, baseURL }) => {
  await signUp(page, baseURL!, newUserName("finish"));
  await page.getByRole("button", { name: "Новая тренировка" }).click();
  await page.getByRole("link", { name: /сегодня/ }).click();

  await page.getByRole("button", { name: "Написать план" }).click();
  await page.getByLabel("План: одна строка — одно упражнение").fill("squat 100x5x2\nbench press 80x5");
  await page.getByRole("button", { name: "Готово" }).click();

  const entry = (name: string) =>
    page.getByRole("listitem").filter({ has: page.getByRole("heading", { name, exact: true }) });
  const squat = entry("squat");
  // From the Starter list, shown by its Primary name.
  const bench = entry("Bench press");
  await squat.getByRole("button", { name: "✓ Сделано" }).click();
  await expect(squat.getByRole("button", { name: /^Подход 1:/ })).toBeVisible();
  await squat.getByRole("button", { name: "✓ Сделано" }).click();
  await expect(squat.getByRole("button", { name: /^Подход 2:/ })).toBeVisible();

  await page.getByRole("button", { name: "Завершить тренировку" }).click();

  await expect(page.getByText("Тренировка завершена.")).toBeVisible();
  await expect(squat.getByText("не выполнен")).toHaveCount(0);
  await expect(bench.getByText("не выполнен")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "✓ Сделано" })).toHaveCount(0);

  await page.getByRole("link", { name: "← Тренировки" }).click();
  await expect(page.getByRole("link", { name: /сегодня/ })).toContainText("завершена");
});
