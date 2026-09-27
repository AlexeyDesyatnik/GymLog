# GymLog

A strength-training log meant to be as quick to fill in as a paper notebook, with templates and long-term analysis on top. Recording friction matters more than data completeness.

## Language

### Workouts

**Workout** (тренировка):
One training session of one user on a set date, made of Entries. Rescheduling a Workout means changing its date.
_Avoid_: Session, training

**Entry** (упражнение в тренировке):
One Exercise's appearance in a Workout, holding its planned and performed Sets. The same Exercise may have several Entries in one Workout.
_Avoid_: Workout exercise, slot, exercise (in this sense)

**Plan** (план):
The planned Sets of one Workout. Only the user edits it; what is actually performed never changes it.
_Avoid_: Program, training plan

**Plan notation** (нотация плана):
The text form of a Plan: one line per Entry, the Exercise name followed by groups of weight x reps x sets, each optionally with a Target RPE after `@`, e.g. `bench press 80x5x3@7 70x8`. The reps may be a Rep range (`bicep curl 15x10-12x3`). Plans are typed and edited in it.
_Avoid_: Plan text, syntax

**Template** (шаблон):
A past Workout used as the source of a new Workout's Plan: its Plan is copied, or its performed Sets when it had no Plan. Any Workout can serve as one; there is no separate template object.
_Avoid_: Preset, routine

**Program** (программа):
A training schedule spanning many Workouts, built from Templates.
_Avoid_: Plan, training plan (тренировочный план)

**Substitute** (замена):
An Entry performed instead of a whole planned Entry of a different Exercise. The replaced Entry's planned Sets count as replaced, not as Not performed.
_Avoid_: Swap, alternative

**Finished** (завершена):
The state of a Workout the user has declared fully recorded. A Workout is either Finished or not; there are no separate planned or in-progress states. A Finished Workout is read-only; finishing can be undone, and that is the only way to change it.
_Avoid_: Closed, completed

**Not performed** (не выполнен):
A planned Set with no performed Set paired to it in a Finished Workout, where the Entry was not replaced by a Substitute. No reason is recorded.
_Avoid_: Skipped, missed, failed

### Sets

**Set** (подход):
One attempt at an Exercise: a Weight and Reps, optionally an RPE and a Comment. Warm-up sets are not distinguished; anything recorded is a Set.
_Avoid_: Approach, series, warm-up set

**Planned Set** (запланированный подход):
A Set in the Plan: what the user intends to do.

**Performed Set** (выполненный подход):
A Set the user actually did. Within an Entry, performed Sets pair with planned Sets by order; any beyond the planned count are simply performed Sets with no pair. Only the last performed Set of an Entry can be deleted, so deleting never re-pairs the ones before it.
_Avoid_: Actual set, logged set, unplanned set

**Confirm** (подтвердить подход):
To record the next Planned Set that has no Performed Set paired with it as done as planned: a Performed Set with its Weight and Reps, and no RPE or Comment. A Planned Set with a Rep range can't be Confirmed, since the Reps actually done must be given.
_Avoid_: Check off, complete, tick

**Weight** (вес):
The load number the user writes for a Set, in kg. Optional: blank for bodyweight exercises; for weighted bodyweight exercises it is the added load; for dumbbells it is the number on one dumbbell.
_Avoid_: Load

**Reps** (повторы):
The number of repetitions actually completed in a Set. A failed repetition is not counted.
_Avoid_: Repetitions

**Rep range** (диапазон повторов):
Planned Reps given as a lowest and highest count, e.g. 10-12. A Performed Set with any Reps within it is done as planned.
_Avoid_: Rep target, rep interval

**RPE**:
Rate of perceived exertion for a performed Set, one of: below 5, 5, 6, 7, 7.5, 8, 8.5, 9, 9.5, 10. Finer steps only where effort is high enough to matter. Optional; its absence is a normal state and is never defaulted or filled in, not even from a Target RPE.
_Avoid_: RIR

**Target RPE** (целевой RPE):
The RPE a Plan aims for on the first Set of a group, one of 5, 6, 7, 7.5, 8, 8.5, 9, 9.5, 10. A guide for adjusting the Weight by feel, never recorded as a performed Set's RPE.
_Avoid_: Planned RPE, RPE target

**Comment** (комментарий):
Free text attached to a Set, for anything unusual: pain, broken technique, a failed repetition.
_Avoid_: Note, flag

### Exercises

**Exercise** (упражнение):
A named movement in one user's Exercise catalog. Exercises are flat: variations (paused bench press, incline dumbbell press) are separate Exercises with no hierarchy.
_Avoid_: Movement, variation

**Primary name** (основное название):
The one name of an Exercise shown everywhere. The user can change it.

**Alternative name** (дополнительное название):
Any other name of an Exercise, used only to find it. Within a catalog, a name belongs to at most one Exercise.
_Avoid_: Alias, synonym

**Exercise catalog** (справочник упражнений):
All Exercises belonging to one user. Never shared between users.
_Avoid_: Exercise library, exercise database

**Starter list** (стартовый список):
Common Exercises, each with an English Primary name and a Russian Alternative name, copied into a new user's Exercise catalog once when the account is created. Later changes to the list do not reach existing catalogs.
_Avoid_: Default exercises, presets

**Merge** (объединение):
Combining two Exercises that turned out to be the same one into a single Exercise with their joint history. The target keeps its Primary name; the other's names become Alternative names. Cannot be undone.
_Avoid_: Link, deduplicate

### Users

**User** (пользователь):
A person with their own Workouts and Exercise catalog, who signs in with a Login and a password. A user comes to exist only through an Invite.
_Avoid_: Account (the interface may still say «аккаунт»)

**Owner** (владелец):
The one User who runs GymLog: the only one who creates Invites and Reset links.
_Avoid_: Admin; "owner" for the User whose records they are

**Login** (логин):
The name a User signs in with, chosen when they use their Invite. No two Users have the same Login, ignoring case.
_Avoid_: Username, email

**Invite** (приглашение):
A one-time link from the Owner through which a new User chooses a Login and a password.

**Reset link** (ссылка для нового пароля):
A one-time link from the Owner through which a User who forgot their password sets a new one.
_Avoid_: Password reset, recovery email
