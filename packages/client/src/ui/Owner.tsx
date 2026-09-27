import { useState } from "react";
import type { AccountSummary } from "@gymlog/shared";
import type { Journal } from "../journal/journal.ts";
import { inviteLink, passwordResetLink } from "./useRoute.ts";

/** What only the owner does: Invites for new users, and links for new passwords for those who forgot theirs. */
export function OwnerTools({ journal }: { journal: Journal }) {
  return (
    <>
      <InviteCreator journal={journal} />
      <AccountList journal={journal} />
    </>
  );
}

function InviteCreator({ journal }: { journal: Journal }) {
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setError(null);
    try {
      setLink(inviteLink(await journal.account.createInvite()));
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

/** The accounts, each with a way to give its user a link for a new password. */
function AccountList({ journal }: { journal: Journal }) {
  const [accounts, setAccounts] = useState<AccountSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      setAccounts(await journal.account.accounts());
    } catch (failure) {
      setError(String(failure));
    }
  }

  return (
    <section className="owner-tool">
      {accounts === null ? (
        <button className="button" type="button" onClick={() => void load()}>
          Аккаунты и пароли
        </button>
      ) : (
        <ul className="accounts">
          {accounts.map((account) => (
            <AccountRow key={account.userId} journal={journal} account={account} />
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

function AccountRow({ journal, account }: { journal: Journal; account: AccountSummary }) {
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setError(null);
    try {
      setLink(passwordResetLink(await journal.account.createPasswordReset(account.userId)));
    } catch (failure) {
      setError(String(failure));
    }
  }

  return (
    <li className="account">
      <div className="account-head">
        <span className="account-login">{account.login}</span>
        {account.owner && <span className="finished-tag">владелец</span>}
        {!account.hasPassword && <span className="finished-tag">без пароля</span>}
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
