import * as p from "@clack/prompts";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ROOT } from "./config";
import {
  tasks,
  taskNames,
  languageNames,
  isTask,
  isFeedbackLanguage,
  type Selection,
  type FeedbackLanguage,
} from "./options";

const settingsPath = join(ROOT, ".local", "settings.json");
export class Cancelled extends Error {}
type Choice = { value: string; label: string };
export type WizardUI = {
  pick(message: string, choices: Choice[], initial: string): Promise<string>;
  confirm(message: string): Promise<boolean>;
  show(message: string): void;
};
function answer<T>(value: T | symbol): T {
  if (p.isCancel(value)) throw new Cancelled("Запуск отменён.");
  return value as T;
}
const ui: WizardUI = {
  async pick(message, options, initialValue) {
    return answer(await p.select({ message, options, initialValue }));
  },
  async confirm(message) {
    return answer(
      await p.confirm({
        message,
        initialValue: true,
        active: "Да",
        inactive: "Нет",
      }),
    );
  },
  show(message) {
    p.note(message, "Настройки запуска");
  },
};

export async function loadPreferences(
  path = settingsPath,
): Promise<Partial<Selection>> {
  try {
    const data = await Bun.file(path).json();
    return {
      ...(isTask(data.task) ? { task: data.task } : {}),
      ...(typeof data.language === "string" &&
      /^(auto|[a-z]{2,3})$/.test(data.language)
        ? { language: data.language }
        : {}),
      ...(isFeedbackLanguage(data.feedbackLanguage)
        ? { feedbackLanguage: data.feedbackLanguage }
        : {}),
    };
  } catch {
    return {};
  }
}

export async function savePreferences(
  selection: Selection,
  path = settingsPath,
) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  await writeFile(
    temporary,
    JSON.stringify(
      {
        task: selection.task,
        language: selection.language,
        feedbackLanguage: selection.feedbackLanguage,
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  await rename(temporary, path);
}

export async function collectSelection(
  input: string,
  textInput: boolean,
  preset: Partial<Selection>,
  saved: Partial<Selection>,
  prompts = ui,
): Promise<Selection> {
  const task =
    preset.task ||
    (await prompts.pick(
      "Что сделать с файлом?",
      tasks.map((value) => ({ value, label: taskNames[value] })),
      isTask(saved.task) ? saved.task : "coach",
    ));
  if (!isTask(task) && task !== "analyze")
    throw new Error("Неизвестная задача.");
  const languages: Choice[] = Object.entries(languageNames).map(
    ([value, label]) => ({ value, label }),
  );
  if (
    saved.language &&
    !languages.some((item) => item.value === saved.language)
  )
    languages.push({ value: saved.language, label: saved.language });
  // Text already exists; language can be inferred by the task from its content.
  const language =
    preset.language ||
    (textInput
      ? "auto"
      : await prompts.pick(
          "Язык записи?",
          languages,
          saved.language || "auto",
        ));
  let feedbackLanguage: FeedbackLanguage =
    preset.feedbackLanguage || saved.feedbackLanguage || "ru";
  if (task !== "transcribe" && !preset.feedbackLanguage) {
    const choice = await prompts.pick(
      "На каком языке дать результат?",
      [
        { value: "ru", label: "Русский" },
        { value: "en", label: "English" },
        { value: "pl", label: "Polski" },
      ],
      feedbackLanguage,
    );
    if (!isFeedbackLanguage(choice))
      throw new Error("Неподдерживаемый язык результата.");
    feedbackLanguage = choice;
  }
  prompts.show(
    `${input}\n${taskNames[task]}\n${textInput ? "Готовый текст; Whisper не запускается" : `Язык записи: ${languageNames[language] || language}`}\n${task === "transcribe" ? "Обработка локально" : `Язык результата: ${languageNames[feedbackLanguage]}\nТекст будет отправлен в OpenAI`}`,
  );
  if (!(await prompts.confirm("Начать обработку?")))
    throw new Cancelled("Запуск отменён.");
  return { task, language, feedbackLanguage };
}

export async function wizard(
  input: string,
  textInput: boolean,
  preset: Partial<Selection>,
) {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error(
      "Мастер требует интерактивный терминал. Для прямого запуска укажите --task coach|meeting|note|transcribe.",
    );
  p.intro("whisper101");
  const selection = await collectSelection(
    input,
    textInput,
    preset,
    await loadPreferences(),
  );
  try {
    await savePreferences(selection);
  } catch {
    console.warn("Не удалось сохранить настройки; обработка продолжится.");
  }
  p.outro("Начинаю обработку.");
  return selection;
}
