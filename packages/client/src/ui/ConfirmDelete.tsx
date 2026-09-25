import type { ReactNode } from "react";

interface ConfirmDeleteProps {
  /** The list item's own class, e.g. "workout", so the confirmation takes its place. */
  className: string;
  question: ReactNode;
  onDelete: () => Promise<void>;
  onCancel: () => void;
}

/** Asks before deleting, in place of the item; "Отмена" has the focus, so a stray tap or Enter deletes nothing. */
export function ConfirmDelete({ className, question, onDelete, onCancel }: ConfirmDeleteProps) {
  return (
    <li className={`${className} confirming`} role="alertdialog" aria-label="Подтверждение удаления">
      <p className="confirm-text">{question}</p>
      <div className="actions">
        <button className="button danger" type="button" onClick={() => void onDelete()}>
          Удалить
        </button>
        <button className="button" type="button" onClick={onCancel} autoFocus>
          Отмена
        </button>
      </div>
    </li>
  );
}
