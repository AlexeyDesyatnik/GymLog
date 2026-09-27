/**
 * The Starter list: common Exercises, each an English Primary name and a Russian Alternative
 * name, copied into a new User's Exercise catalog once, when the User comes to exist. Changing
 * it later doesn't touch catalogs already made. No two names here may match ignoring case,
 * since a name belongs to one Exercise.
 */
export const STARTER_LIST: readonly { primaryName: string; alternativeName: string }[] = [
  // Legs
  { primaryName: "Barbell back squat", alternativeName: "Приседания со штангой" },
  { primaryName: "Front squat", alternativeName: "Фронтальные приседания" },
  { primaryName: "Goblet squat", alternativeName: "Гоблет-приседания" },
  { primaryName: "Hack squat", alternativeName: "Гакк-приседания" },
  { primaryName: "Leg press", alternativeName: "Жим ногами" },
  { primaryName: "Lunge", alternativeName: "Выпады" },
  { primaryName: "Bulgarian split squat", alternativeName: "Болгарские выпады" },
  { primaryName: "Leg extension", alternativeName: "Разгибание ног в тренажёре" },
  { primaryName: "Leg curl", alternativeName: "Сгибание ног в тренажёре" },
  { primaryName: "Calf raise", alternativeName: "Подъём на носки" },
  { primaryName: "Hip abduction", alternativeName: "Разведение ног в тренажёре" },
  { primaryName: "Hip adduction", alternativeName: "Сведение ног в тренажёре" },
  // Hinges and lower back
  { primaryName: "Deadlift", alternativeName: "Становая тяга" },
  { primaryName: "Sumo deadlift", alternativeName: "Становая тяга сумо" },
  { primaryName: "Romanian deadlift", alternativeName: "Румынская тяга" },
  { primaryName: "Good morning", alternativeName: "Гуд морнинг" },
  { primaryName: "Hip thrust", alternativeName: "Ягодичный мост" },
  { primaryName: "Hyperextension", alternativeName: "Гиперэкстензия" },
  { primaryName: "Kettlebell swing", alternativeName: "Махи гирей" },
  // Chest
  { primaryName: "Bench press", alternativeName: "Жим лёжа" },
  { primaryName: "Incline bench press", alternativeName: "Жим лёжа на наклонной скамье" },
  { primaryName: "Close-grip bench press", alternativeName: "Жим лёжа узким хватом" },
  { primaryName: "Dumbbell bench press", alternativeName: "Жим гантелей лёжа" },
  { primaryName: "Incline dumbbell press", alternativeName: "Жим гантелей на наклонной скамье" },
  { primaryName: "Chest press machine", alternativeName: "Жим от груди в тренажёре" },
  { primaryName: "Dumbbell fly", alternativeName: "Разводка гантелей лёжа" },
  { primaryName: "Cable crossover", alternativeName: "Сведение рук в кроссовере" },
  { primaryName: "Pec deck", alternativeName: "Сведение рук в тренажёре" },
  { primaryName: "Push-up", alternativeName: "Отжимания от пола" },
  { primaryName: "Dip", alternativeName: "Отжимания на брусьях" },
  // Back
  { primaryName: "Pull-up", alternativeName: "Подтягивания" },
  { primaryName: "Chin-up", alternativeName: "Подтягивания обратным хватом" },
  { primaryName: "Lat pulldown", alternativeName: "Тяга верхнего блока" },
  { primaryName: "Seated cable row", alternativeName: "Тяга горизонтального блока" },
  { primaryName: "Barbell row", alternativeName: "Тяга штанги в наклоне" },
  { primaryName: "Dumbbell row", alternativeName: "Тяга гантели в наклоне" },
  { primaryName: "T-bar row", alternativeName: "Тяга Т-грифа" },
  { primaryName: "Shrug", alternativeName: "Шраги" },
  // Shoulders
  { primaryName: "Overhead press", alternativeName: "Армейский жим" },
  { primaryName: "Seated dumbbell press", alternativeName: "Жим гантелей сидя" },
  { primaryName: "Lateral raise", alternativeName: "Махи гантелями в стороны" },
  { primaryName: "Rear delt fly", alternativeName: "Махи гантелями в наклоне" },
  { primaryName: "Face pull", alternativeName: "Тяга каната к лицу" },
  { primaryName: "Upright row", alternativeName: "Тяга штанги к подбородку" },
  // Arms
  { primaryName: "Barbell curl", alternativeName: "Подъём штанги на бицепс" },
  { primaryName: "Dumbbell curl", alternativeName: "Подъём гантелей на бицепс" },
  { primaryName: "Hammer curl", alternativeName: "Молотки" },
  { primaryName: "Triceps pushdown", alternativeName: "Разгибание рук на блоке" },
  { primaryName: "Skull crusher", alternativeName: "Французский жим" },
  { primaryName: "Overhead triceps extension", alternativeName: "Разгибание рук из-за головы" },
  // Abs
  { primaryName: "Crunch", alternativeName: "Скручивания" },
  { primaryName: "Hanging leg raise", alternativeName: "Подъём ног в висе" },
  { primaryName: "Ab wheel rollout", alternativeName: "Ролик для пресса" },
];
