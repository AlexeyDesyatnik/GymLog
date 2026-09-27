import { expect, test } from "vitest";
import { localDate } from "@gymlog/shared";
import { pushAs, startTestServer, userIdOf, type Device, type TestServer } from "./testing/devices.ts";

/** A signed-in phone and a Set record of its user, as a device sends it, with these values. */
async function setRecordOn(
  server: TestServer,
  values: { kind: "planned" | "performed"; reps: number; rpe: number | null },
) {
  const phone = server.device();
  await phone.signUp("alexey");
  const record = {
    type: "set",
    id: crypto.randomUUID(),
    ownerId: await userIdOf(phone, server.url),
    updatedAt: 5_000,
    deleted: false,
    entryId: crypto.randomUUID(),
    position: 0,
    weight: 80,
    comment: null,
    ...values,
  };
  return { phone, record };
}

async function refusedIds(phone: Device, server: TestServer, records: unknown[]): Promise<(string | null)[]> {
  const { answer } = await pushAs(phone, server.url, records);
  return answer.refused.map((r) => r.id);
}

test("a Planned Set whose Target RPE is below 5 is refused", async () => {
  const server = await startTestServer();
  const { phone, record } = await setRecordOn(server, { kind: "planned", reps: 5, rpe: 4 });

  expect(await refusedIds(phone, server, [record])).toEqual([record.id]);
});

test("a Planned Set with zero reps is refused", async () => {
  const server = await startTestServer();
  const { phone, record } = await setRecordOn(server, { kind: "planned", reps: 0, rpe: null });

  expect(await refusedIds(phone, server, [record])).toEqual([record.id]);
});

test("a Performed Set with zero reps and RPE below 5 is taken", async () => {
  const server = await startTestServer();
  const { phone, record } = await setRecordOn(server, { kind: "performed", reps: 0, rpe: 4 });

  expect(await refusedIds(phone, server, [record])).toEqual([]);
});

test("only the invalid records of a push are refused; the others are taken", async () => {
  const server = await startTestServer();
  const { phone, record } = await setRecordOn(server, { kind: "planned", reps: 0, rpe: null });
  const valid = { ...record, id: crypto.randomUUID(), reps: 5 };

  expect(await refusedIds(phone, server, [valid, record])).toEqual([record.id]);
});

test("a Plan with a Rep range and Target RPEs reaches the other device as written", async () => {
  const server = await startTestServer();
  const phone = server.device();
  const computer = server.device();
  await phone.signUp("alexey");
  await computer.signIn("alexey");

  const workout = await computer.journal.createWorkout(localDate("2026-09-27"));
  await computer.journal.setPlan(workout.id, "bicep curl 15x10-12x3@8\nsquat 100x5@7 90x5x2");
  await computer.journal.sync.now();
  await phone.journal.sync.now();

  const arrived = await phone.journal.getWorkout(workout.id);
  expect(arrived?.planNotation).toBe("bicep curl 15x10-12x3@8\nsquat 100x5@7 90x5x2");
});
