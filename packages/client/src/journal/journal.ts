import { Dexie, type EntityTable } from "dexie";
import type { LocalDate, WorkoutRecord } from "@gymlog/shared";
import { newId } from "./ids.ts";

export interface Workout {
  id: string;
  date: LocalDate;
}

/** The single interface the UI uses for everything a user does with their Workouts. */
export interface Journal {
  createWorkout(date: LocalDate): Promise<Workout>;
  listWorkouts(): Promise<Workout[]>;
  changeWorkoutDate(id: string, date: LocalDate): Promise<void>;
  deleteWorkout(id: string): Promise<void>;
  close(): void;
}

export interface JournalOptions {
  /** IndexedDB database name. */
  name?: string;
  /** Device clock in milliseconds. */
  now?: () => number;
}

type JournalDb = Dexie & { workouts: EntityTable<WorkoutRecord, "id"> };

export function openJournal({ name = "gymlog", now = Date.now }: JournalOptions = {}): Journal {
  const db = new Dexie(name) as JournalDb;
  db.version(1).stores({ workouts: "id, [date+createdAt]" });

  return {
    async createWorkout(date) {
      const time = now();
      const record: WorkoutRecord = { id: newId(), date, createdAt: time, updatedAt: time, deleted: false };
      await db.workouts.add(record);
      return toWorkout(record);
    },

    async listWorkouts() {
      const records = await db.workouts.orderBy("[date+createdAt]").reverse().toArray();
      return records.filter((r) => !r.deleted).map(toWorkout);
    },

    async changeWorkoutDate(id, date) {
      await db.workouts.update(id, { date, updatedAt: now() });
    },

    async deleteWorkout(id) {
      // A tombstone rather than a removal, so the deletion can reach other devices.
      await db.workouts.update(id, { deleted: true, updatedAt: now() });
    },

    close() {
      db.close();
    },
  };
}

function toWorkout(record: WorkoutRecord): Workout {
  return { id: record.id, date: record.date };
}
