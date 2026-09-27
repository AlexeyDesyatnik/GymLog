import { expect, test } from "vitest";
import { localDate } from "@gymlog/shared";
import { pullAs, startTestServer } from "./testing/devices.ts";

test("someone without an account can't sign in: an unknown login is refused like a wrong password", async () => {
  const server = await startTestServer();
  const phone = server.device();

  await expect(phone.signIn("stranger")).rejects.toMatchObject({ refusal: "wrongPassword" });
});

test("an Invite creates an account with the login and password chosen, which then sign in on another device, where the user's Workouts are", async () => {
  const server = await startTestServer();
  const phone = server.device();
  await phone.signUp("alexey", { invite: await server.ownerInvite(), password: "squat 100 x 5" });
  const workout = await phone.journal.createWorkout(localDate("2026-09-27"));
  await phone.journal.sync.now();

  const computer = server.device();
  await computer.signIn("alexey", "squat 100 x 5");

  expect((await computer.journal.listWorkouts()).map((w) => w.id)).toEqual([workout.id]);
});

test("a wrong password is refused, like an unknown login", async () => {
  const server = await startTestServer();
  await server.device().signUp("alexey", { password: "squat 100 x 5" });

  await expect(server.device().signIn("alexey", "squat 100 x 6")).rejects.toMatchObject({ refusal: "wrongPassword" });
});

test("an Invite gives one account; anyone else coming with it afterwards is refused", async () => {
  const server = await startTestServer();
  const invite = await server.ownerInvite();
  await server.device().signUp("alexey", { invite });

  const mariasPhone = server.device();

  await expect(mariasPhone.signUp("maria", { invite })).rejects.toMatchObject({ refusal: "inviteUnusable" });
});

test("two people coming with one Invite at the same moment: only one of them gets an account", async () => {
  const server = await startTestServer();
  const invite = await server.ownerInvite();

  const outcomes = await Promise.allSettled([
    server.device().signUp("alexey", { invite }),
    server.device().signUp("maria", { invite }),
  ]);

  expect(outcomes.map((o) => o.status).sort()).toEqual(["fulfilled", "rejected"]);
});

test("a login already taken, in any case, is refused, and the Invite stays usable for another login", async () => {
  const server = await startTestServer();
  await server.device().signUp("alexey");
  const invite = await server.inviteFromOwner();

  const phone = server.device();
  await expect(phone.signUp(" Alexey ", { invite })).rejects.toMatchObject({ refusal: "loginTaken" });
  await phone.signUp("maria", { invite });

  expect(phone.journal.sync.state()).toEqual({ status: "synced", owner: false });
});

test("a password shorter than 8 characters is refused, and the Invite stays usable", async () => {
  const server = await startTestServer();
  const invite = await server.inviteFromOwner();
  const phone = server.device();

  await expect(phone.signUp("maria", { invite, password: "1234567" })).rejects.toThrow("400");

  expect(await phone.journal.account.inviteUsable(invite)).toBe(true);
});

test("after 5 wrong passwords for a login, even the right one is refused for a while; other logins aren't held up", async () => {
  const server = await startTestServer();
  await server.device().signUp("alexey");
  await server.device().signUp("maria");
  const guesser = server.device();
  for (let attempt = 1; attempt <= 5; attempt++) {
    await expect(guesser.signIn("alexey", `guess ${attempt} of 5`)).rejects.toMatchObject({ refusal: "wrongPassword" });
  }

  await expect(server.device().signIn("alexey")).rejects.toMatchObject({ refusal: "tooManyAttempts" });
  await server.device().signIn("maria");
});

test("a new user's Exercise catalog starts from the Starter list: an Exercise is found by its Russian name and shown by its English Primary name", async () => {
  const server = await startTestServer();
  const phone = server.device();
  await phone.signUp("alexey");

  const workout = await phone.journal.createWorkout(localDate("2026-09-27"));
  await phone.journal.setPlan(workout.id, "жим лёжа 80x5x3\nПриседания со штангой 100x5");

  expect((await phone.journal.getWorkout(workout.id))?.planNotation).toBe(
    "Bench press 80x5x3\nBarbell back squat 100x5",
  );
});

test("the Starter list is copied into a catalog once: signing in again, on any device, adds no second copy", async () => {
  const server = await startTestServer();
  const phone = server.device();
  await phone.signUp("alexey");
  const afterSigningUp = await pullAs(phone, server.url);

  await server.device().signIn("alexey");
  const computer = server.device();
  await computer.signIn("alexey");

  const exercises = (await pullAs(computer, server.url)).records.filter((r) => r.type === "exercise");
  expect(exercises.length).toBeGreaterThan(0);
  expect(exercises).toEqual(afterSigningUp.records.filter((r) => r.type === "exercise"));
});

test("whoever creates an account through the owner's first Invite, from the server command, is the owner, and their device knows it", async () => {
  const server = await startTestServer();
  const ownersPhone = server.device();

  await ownersPhone.signUp("alexey", { invite: await server.ownerInvite() });

  expect(ownersPhone.journal.sync.state()).toEqual({ status: "synced", owner: true });
});

test("the owner creates an Invite, through which a new user gets an account who isn't the owner", async () => {
  const server = await startTestServer();
  const ownersPhone = server.device();
  await ownersPhone.signUp("alexey", { invite: await server.ownerInvite() });

  const invite = await ownersPhone.journal.account.createInvite();
  const mariasPhone = server.device();
  await mariasPhone.signUp("maria", { invite });

  expect(mariasPhone.journal.sync.state()).toEqual({ status: "synced", owner: false });
});

test("only the owner can create Invites", async () => {
  const server = await startTestServer();
  const ownersPhone = server.device();
  await ownersPhone.signUp("alexey", { invite: await server.ownerInvite() });
  const mariasPhone = server.device();
  await mariasPhone.signUp("maria", { invite: await ownersPhone.journal.account.createInvite() });
  const stranger = server.device();

  await expect(mariasPhone.journal.account.createInvite()).rejects.toThrow("403");
  await expect(stranger.journal.account.createInvite()).rejects.toThrow();
  const invitesAsked = await Promise.all(
    [mariasPhone, stranger].map((device) => device.fetch(`${server.url}/api/invites`, { method: "POST" })),
  );
  expect(invitesAsked.map((response) => response.status)).toEqual([403, 401]);
});

test("a device nobody has ever signed in on says so, even when the server can't be reached, so the app asks to sign in first", async () => {
  const server = await startTestServer();
  const phone = server.device();
  phone.goOffline();

  await expect(phone.journal.sync.now()).rejects.toThrow("offline");

  expect(phone.journal.sync.state()).toEqual({ status: "neverSignedIn" });
});

test("an Invite can be checked before creating an account: it is usable until someone gets an account through it", async () => {
  const server = await startTestServer();
  const invite = await server.ownerInvite();
  const phone = server.device();

  const before = await phone.journal.account.inviteUsable(invite);
  await phone.signUp("maria", { invite });
  const after = await server.device().journal.account.inviteUsable(invite);
  const neverMade = await phone.journal.account.inviteUsable("no-such-invite");

  expect([before, after, neverMade]).toEqual([true, false, false]);
});

test("once there is an owner, the server command makes no more of the owner's Invites", async () => {
  const server = await startTestServer();
  const unused = await server.ownerInvite();
  await server.device().signUp("alexey", { invite: await server.ownerInvite() });

  await expect(server.ownerInvite()).rejects.toThrow("already has an owner");
  await expect(server.device().signUp("maria", { invite: unused })).rejects.toMatchObject({
    refusal: "inviteUnusable",
  });
});

test("the owner sees the accounts by login", async () => {
  const server = await startTestServer();
  const ownersPhone = server.device();
  await ownersPhone.signUp("alexey", { invite: await server.ownerInvite() });
  await server.device().signUp("maria", { invite: await ownersPhone.journal.account.createInvite() });

  const accounts = await ownersPhone.journal.account.accounts();

  expect(accounts.map(({ login, owner, hasPassword }) => ({ login, owner, hasPassword }))).toEqual([
    { login: "alexey", owner: true, hasPassword: true },
    { login: "maria", owner: false, hasPassword: true },
  ]);
});

test("the owner's link for a new password sets it once: the old password stops working, and the user's other devices are signed out", async () => {
  const server = await startTestServer();
  const ownersPhone = server.device();
  await ownersPhone.signUp("alexey", { invite: await server.ownerInvite() });
  const mariasPhone = server.device();
  const invite = await ownersPhone.journal.account.createInvite();
  await mariasPhone.signUp("maria", { invite, password: "old password" });
  const maria = (await ownersPhone.journal.account.accounts()).find((a) => a.login === "maria")!;

  const reset = await ownersPhone.journal.account.createPasswordReset(maria.userId);
  const mariasComputer = server.device();
  expect(await mariasComputer.journal.account.passwordResetLogin(reset)).toBe("maria");
  await mariasComputer.journal.account.resetPassword(reset, "new password");
  await mariasPhone.journal.sync.now();

  expect(mariasComputer.journal.sync.state()).toEqual({ status: "synced", owner: false });
  expect(mariasPhone.journal.sync.state()).toEqual({ status: "signedOut" });
  await expect(server.device().signIn("maria", "old password")).rejects.toMatchObject({ refusal: "wrongPassword" });
  await server.device().signIn("maria", "new password");
  await expect(server.device().journal.account.resetPassword(reset, "third password")).rejects.toMatchObject({
    refusal: "resetUnusable",
  });
  expect(await server.device().journal.account.passwordResetLogin(reset)).toBeNull();
});

test("only the owner can see accounts and create links for new passwords", async () => {
  const server = await startTestServer();
  const ownersPhone = server.device();
  await ownersPhone.signUp("alexey", { invite: await server.ownerInvite() });
  const mariasPhone = server.device();
  await mariasPhone.signUp("maria", { invite: await ownersPhone.journal.account.createInvite() });
  const [owner] = await ownersPhone.journal.account.accounts();
  const stranger = server.device();

  const asked = await Promise.all(
    [mariasPhone, stranger].flatMap((device) => [
      device.fetch(`${server.url}/api/accounts`),
      device.fetch(`${server.url}/api/password-resets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: owner!.userId }),
      }),
    ]),
  );

  expect(asked.map((response) => response.status)).toEqual([403, 403, 401, 401]);
});

test("the server command gives the owner a link for a new password of their own", async () => {
  const server = await startTestServer();
  await server.device().signUp("alexey", { invite: await server.ownerInvite(), password: "forgotten password" });

  const reset = await server.ownerPasswordReset();
  await server.device().journal.account.resetPassword(reset, "remembered password");

  const phone = server.device();
  await phone.signIn("alexey", "remembered password");
  expect(phone.journal.sync.state()).toEqual({ status: "synced", owner: true });
});

test("the server command gives no link for a new password while there is no owner", async () => {
  const server = await startTestServer();

  await expect(server.ownerPasswordReset()).rejects.toThrow("no owner");
});
