# Plan notation shows "x" and accepts "/"

Plans are typed as text on a phone. The first version of this decision chose `/` for display, reasoning that `x` costs a keyboard mode switch for every separator because phone number layouts have no `x`. A prototype tried on the owner's phone (Honor 400 with Gboard and Yandex Keyboard) showed otherwise: with the keyboard's number row turned on, `x` is the most convenient, since digits and `x` are then in the same layout; without the number row, `x` and `/` feel about the same. `x` also matches the owner's paper habit.

- Plans are displayed with `x`: `bench press 80x5x3 70x8`, `pull-up x8x3` for an empty weight, a decimal comma for weights.
- Input accepts `x`, Cyrillic `х`, `×`, `*` and `/`, including the paper form with spaces around the separator (`80 x 5 x 3`, `x 8 x 3`).
- Groups are separated by spaces and recognised from the end of the line, so digits in the Exercise name don't break parsing.
- The owner turns on the number row in both keyboards.

## Considered Options

- **`/` for display**: equal to `x` without the number row and worse with it.
- **Numbers separated by spaces** (`bench press 80 5 3, 70 8`): the fastest to type, but hard to read and ambiguous. Digits in the name combined with omitted sets, or a forgotten comma between groups, are silently misread (`жим 3 75 4` reads as 3 kg × 75 reps). Not accepted as input either, so it can't collide with the `x` form.
