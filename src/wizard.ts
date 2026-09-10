import * as p from "@clack/prompts";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ROOT } from "./config";
import {
  tasks,
  taskNames,
  languageNames,
  defaultModel,
  isTask,
  isFeedbackLanguage,
  isModelName,
  type Selection,
  type FeedbackLanguage,
} from "./options";

const settingsPath = join(ROOT, ".local", "settings.json");
export class Cancelled extends Error {}
type Choice = { value: string; label: string };
export type WizardUI = {
  pick(message: string, choices: Choice[], initial: string): Promise<string>;
  confirm(message: string): Promise<boolean>;
  show(message: string, title?: string): void;
};
function answer<T>(value: T | symbol): T {
  if (p.isCancel(value)) throw new Cancelled("Запуск отменён.");
  return value as T;
}
export const ui: WizardUI = {
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
  show(message, title = "Настройки запуска") {
    p.note(message, title);
  },
};

export type Preferences = Partial<Selection> & { model?: string };

export async function loadPreferences(
  path = settingsPath,
): Promise<Preferences> {
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
      ...(isModelName(data.model) ? { model: data.model } : {}),
    };
  } catch {
    return {};
  }
}

export async function savePreferences(
  values: Preferences,
  path = settingsPath,
) {
  const saved = { ...(await loadPreferences(path)), ...values };
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  await writeFile(
    temporary,
    JSON.stringify(
      {
        ...(saved.task ? { task: saved.task } : {}),
        ...(saved.language ? { language: saved.language } : {}),
        ...(saved.feedbackLanguage
          ? { feedbackLanguage: saved.feedbackLanguage }
          : {}),
        ...(saved.model ? { model: saved.model } : {}),
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  await rename(temporary, path);
}

export type ModelSource = "flag" | "settings" | "env" | "default";
export const modelSources: Record<ModelSource, string> = {
  flag: "флаг --model",
  settings: "настройки",
  env: "OPENAI_MODEL из .env",
  default: "значение по умолчанию",
};

export async function preferredModel(
  override?: string,
  path = settingsPath,
): Promise<{ model: string; source: ModelSource }> {
  if (override) return { model: override, source: "flag" };
  const saved = (await loadPreferences(path)).model;
  if (saved) return { model: saved, source: "settings" };
  if (process.env.OPENAI_MODEL)
    return { model: process.env.OPENAI_MODEL, source: "env" };
  return { model: defaultModel, source: "default" };
}

export async function collectSelection(
  input: string,
  textInput: boolean,
  preset: Partial<Selection>,
  saved: Partial<Selection>,
  prompts = ui,
  recording = false,
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
  if (
    !(await prompts.confirm(recording ? "Начать запись?" : "Начать обработку?"))
  )
    throw new Cancelled("Запуск отменён.");
  return { task, language, feedbackLanguage };
}

export async function wizard(
  input: string,
  textInput: boolean,
  preset: Partial<Selection>,
  recording = false,
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
    ui,
    recording,
  );
  try {
    await savePreferences(selection);
  } catch {
    console.warn("Не удалось сохранить настройки; обработка продолжится.");
  }
  p.outro(recording ? "Начинаю запись." : "Начинаю обработку.");
  return selection;
}
