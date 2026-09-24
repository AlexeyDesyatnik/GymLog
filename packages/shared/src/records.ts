import type { LocalDate } from "./local-date.ts";

/** Fields every synced record carries (parent spec, Records). */
interface SyncedRecord {
  /** Generated on the client, so resending a record never duplicates it. */
  id: string;
  /** Device time of the last change, in milliseconds. */
  updatedAt: number;
  /** Tombstone: deleted records are kept so the deletion can sync. */
  deleted: boolean;
}

export interface WorkoutRecord extends SyncedRecord {
  date: LocalDate;
  createdAt: number;
}
