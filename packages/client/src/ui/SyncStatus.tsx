import { useState, useSyncExternalStore } from "react";
import type { Journal } from "../journal/journal.ts";
import { SignInButtons } from "./SignIn.tsx";
import { inviteLink } from "./useRoute.ts";

/** Whether this device's records reach the user's other devices, the way to sign in again, and Invites for the owner. */
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
          <SignInButtons journal={journal} />
        </section>
      );
    case "synced":
      return (
        <>
          <p className="sync-status">Синхронизировано с другими устройствами.</p>
          {state.owner && <InviteCreator journal={journal} />}
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

/** The owner creates an Invite and sends its link to the person invited. */
function InviteCreator({ journal }: { journal: Journal }) {
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function create() {
    setError(null);
    setCopied(false);
    try {
      setLink(inviteLink(await journal.sync.createInvite()));
    } catch (failure) {
      setError(String(failure));
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // Without the clipboard, the link is there to select by hand.
    }
  }

  return (
    <section className="invite">
      <button className="button" type="button" onClick={() => void create()}>
        Создать приглашение
      </button>
      {error !== null && (
        <p className="sync-status" role="alert">
          Не удалось создать приглашение: {error}
        </p>
      )}
      {link !== null && (
        <>
          <p className="invite-link">{link}</p>
          <p className="hint">Ссылка одноразовая: по ней один человек создаст аккаунт, войдя через VK ID.</p>
          <div className="actions">
            {"share" in navigator && (
              <button
                className="button primary"
                type="button"
                // Closing the share sheet without sending isn't a failure.
                onClick={() => void navigator.share({ title: "Приглашение в GymLog", url: link }).catch(() => {})}
              >
                Отправить
              </button>
            )}
            <button className="button" type="button" onClick={() => void copy(link)}>
              {copied ? "Скопировано" : "Скопировать"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
