import { useSyncExternalStore } from "react";
import type { Journal } from "../journal/journal.ts";
import { OwnerTools } from "./Owner.tsx";
import { SignInForm } from "./SignIn.tsx";

/**
 * Whether this device's records reach the user's other devices, the way to sign in again, and
 * the Owner's Invites and Reset links.
 */
export function SyncStatus({ journal }: { journal: Journal }) {
  const state = useSyncExternalStore(journal.sync.onStateChange, journal.sync.state);
  switch (state.status) {
    case "off":
    case "checking":
    case "neverSignedIn":
    case "starting":
      return null;
    case "signedOut":
      return (
        <section className="sync-sign-in sign-in">
          <p className="sync-status">
            Вход на этом устройстве закончился. Всё записанное сохранено здесь и отправится на сервер, когда вы
            войдёте снова.
          </p>
          <SignInForm journal={journal} />
        </section>
      );
    case "synced":
      return (
        <>
          <p className="sync-status">Синхронизировано с другими устройствами.</p>
          {state.owner && <OwnerTools journal={journal} />}
        </>
      );
    case "otherUser":
      return (
        <p className="sync-status">
          На этом устройстве тренировки другого пользователя, поэтому они не синхронизируются.
        </p>
      );
    case "failed":
      return (
        <p className="sync-status">
          Не удалось синхронизировать. Всё записанное сохранено на этом устройстве, синхронизация повторится сама.
        </p>
      );
  }
}
