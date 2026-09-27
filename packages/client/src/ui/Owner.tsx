import { useState } from "react";
import type { UserSummary } from "@gymlog/shared";
import type { Journal } from "../journal/journal.ts";
import { inviteLink, resetLinkUrl } from "./useRoute.ts";

/** What only the Owner does: Invites for new Users, and Reset links for those who forgot their password. */
export function OwnerTools({ journal }: { journal: Journal }) {
  return (
    <>
      <InviteCreator journal={journal} />
      <UserList journal={journal} />
    </>
  );
}

function InviteCreator({ journal }: { journal: Journal }) {
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setError(null);
    try {
      setLink(inviteLink(await journal.access.createInvite()));
    } catch (failure) {
      setError(String(failure));
    }
  }

  return (
    <section className="owner-tool">
      <button className="button" type="button" onClick={() => void create()}>
        Создать приглашение
      </button>
      {error !== null && (
        <p className="sync-status" role="alert">
          Не удалось создать приглашение: {error}
        </p>
      )}
      {link !== null && (
        <SharedLink
          link={link}
          title="Приглашение в GymLog"
          hint="Ссылка одноразовая: по ней один человек создаст аккаунт, придумав логин и пароль."
        />
      )}
    </section>
  );
}

/** The Users, each with a way to give them a Reset link. */
function UserList({ journal }: { journal: Journal }) {
  const [users, setUsers] = useState<UserSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      setUsers(await journal.access.users());
    } catch (failure) {
      setError(String(failure));
    }
  }

  return (
    <section className="owner-tool">
      {users === null ? (
        <button className="button" type="button" onClick={() => void load()}>
          Аккаунты и пароли
        </button>
      ) : (
        <ul className="user-list">
          {users.map((user) => (
            <UserRow key={user.userId} journal={journal} user={user} />
          ))}
        </ul>
      )}
      {error !== null && (
        <p className="sync-status" role="alert">
          Не удалось загрузить аккаунты: {error}
        </p>
      )}
    </section>
  );
}

function UserRow({ journal, user }: { journal: Journal; user: UserSummary }) {
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setError(null);
    try {
      setLink(resetLinkUrl(await journal.access.createResetLink(user.userId)));
    } catch (failure) {
      setError(String(failure));
    }
  }

  return (
    <li className="user-card">
      <div className="user-head">
        <span className="user-login">{user.login}</span>
        {user.owner && <span className="finished-tag">владелец</span>}
        {!user.hasPassword && <span className="finished-tag">без пароля</span>}
      </div>
      {link === null ? (
        <button className="button quiet" type="button" onClick={() => void create()}>
          Ссылка для нового пароля
        </button>
      ) : (
        <SharedLink
          link={link}
          title="Новый пароль в GymLog"
          hint="Ссылка одноразовая и действует неделю. Когда по ней зададут новый пароль, все прежние входы этого аккаунта закончатся."
        />
      )}
      {error !== null && (
        <p className="sync-status" role="alert">
          Не удалось создать ссылку: {error}
        </p>
      )}
    </li>
  );
}

/** A one-time link to hand to someone: shown in full, and sent or copied with one tap. */
function SharedLink({ link, title, hint }: { link: string; title: string; hint: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // Without the clipboard, the link is there to select by hand.
    }
  }

  return (
    <>
      <p className="invite-link">{link}</p>
      <p className="hint">{hint}</p>
      <div className="actions">
        {"share" in navigator && (
          <button
            className="button primary"
            type="button"
            // Closing the share sheet without sending isn't a failure.
            onClick={() => void navigator.share({ title, url: link }).catch(() => {})}
          >
            Отправить
          </button>
        )}
        <button className="button" type="button" onClick={() => void copy()}>
          {copied ? "Скопировано" : "Скопировать"}
        </button>
      </div>
    </>
  );
}
