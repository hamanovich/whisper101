import { parseArgs } from "node:util";
import { resolve, extname } from "node:path";
import { config } from "./config";
import { executable, inputFile } from "./transcribe";
import { timed } from "./timing";
import { pipeline } from "./pipeline";
import { Cancelled, wizard } from "./wizard";
import { home } from "./library";
import { ensureReport } from "./report";
import { openLocal } from "./open";
import {
  directSelection,
  isTask,
  isFeedbackLanguage,
  type TaskName,
} from "./options";

const help = `whisper101 - аудио и текст → выбранная задача

bun start                                Новый файл или история записей
bun start history                        Открыть историю
bun start report output/<папка>          Создать/открыть локальный HTML-отчёт
bun run start recording.m4a                Интерактивный мастер
bun run start transcript.txt              Задание по готовому тексту
bun run start file.m4a --task meeting      Прямой запуск без опросника
bun run coach file.m4a                    Короткий запуск тренера (pl → ru)
bun run transcribe file.m4a               Только локальное распознавание
bun run analyze transcript.txt            Прежний текстовый разбор
bun run doctor                           Проверка окружения без API-запроса

--task coach|meeting|note|transcribe       Задача; без параметра открывается мастер
--language auto|pl|en|ru|…                Язык записи; для .txt - подсказка модели
--feedback-language ru|en|pl              Язык результата (по умолчанию ru)
--out DIR                                Новая папка результатов
--model NAME                             Модель OpenAI
--cpu                                    Whisper без GPU
--keep-wav                               Сохранить audio.wav (по умолчанию)
--open                                   Открыть HTML-отчёт после обработки
--refresh                                Для report: обновить HTML, сохранив резервную копию
--help                                   Справка

Стрелки + Enter для выбора, Ctrl+C для отмены. Последние настройки - подсказки
только для мастера. Для --task по умолчанию язык auto (coach: pl), результат ru.
Аудио остаётся локально; задачи кроме transcribe отправляют текст в OpenAI.
Каждый запуск сохраняется в output/<имя>-YYYY-MM-DD/ с защитой от перезаписи.`;

export function argumentsFor(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      task: { type: "string" },
      out: { type: "string" },
      language: { type: "string" },
      model: { type: "string" },
      "feedback-language": { type: "string" },
      "keep-wav": { type: "boolean", default: true },
      cpu: { type: "boolean" },
      open: { type: "boolean" },
      refresh: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  let command = "run";
  if (
    [
      "run",
      "transcribe",
      "analyze",
      "coach",
      "meeting",
      "note",
      "doctor",
      "history",
      "report",
    ].includes(positionals[0] || "")
  )
    command = positionals.shift()!;
  if (values.help) return { command: "help", values, file: undefined };
  const menu = command === "run" && args.length === 0;
  if (values.refresh && command !== "report")
    throw new Error("--refresh доступен только для команды report.");
  if (
    positionals.length !==
    (["doctor", "history"].includes(command) || menu ? 0 : 1)
  )
    throw new Error("Укажите один входной файл. Справка: bun run start --help");
  if (values.language && !/^(auto|[a-z]{2,3})$/.test(values.language))
    throw new Error("Язык: короткий код, например pl, en или auto.");
  if (values.task !== undefined && !isTask(values.task))
    throw new Error(
      "Неизвестная задача: используйте coach, meeting, note или transcribe.",
    );
  if (
    values["feedback-language"] !== undefined &&
    !isFeedbackLanguage(values["feedback-language"])
  )
    throw new Error("Язык результата: ru, en или pl.");
  if (command !== "run" && values.task && command !== values.task)
    throw new Error(
      "Подкоманда и --task задают разные задачи. Используйте один способ выбора.",
    );
  return { command, values, file: positionals[0] };
}

async function doctor() {
  const c = config();
  for (const [label, check] of [
    ["ffmpeg", () => executable(c.ffmpeg)],
    ["whisper.cpp", () => executable(c.whisper)],
    ["Whisper model", () => inputFile(c.whisperModel)],
  ] as const) {
    try {
      await check();
      console.log(`OK: ${label}`);
    } catch (error) {
      console.error((error as Error).message);
      process.exitCode = 1;
    }
  }
  console.log(
    `OpenAI key: ${c.apiKey ? "задан" : "не задан (локальная транскрипция доступна)"}`,
  );
  console.log(`OpenAI model: ${c.model}`);
}

export async function main(args = Bun.argv.slice(2)) {
  const { command, values, file } = argumentsFor(args);
  if (command === "help") return console.log(help);
  if (command === "doctor") return doctor();
  if (command === "report")
    return openLocal(
      await ensureReport(resolve(file!), { refresh: values.refresh }),
    );
  const continued =
    command === "history" || !file
      ? await home(command === "history")
      : undefined;
  if (continued === null) return;
  const input = resolve(continued?.input || file!);
  await inputFile(input);
  const textInput =
    extname(input).toLowerCase().endsWith(".txt") || command === "analyze";
  const task =
    continued?.selection?.task ||
    values.task ||
    (["run", "history"].includes(command) ? undefined : (command as TaskName));
  const feedbackLanguage = values["feedback-language"] as
    "ru" | "en" | "pl" | undefined;
  const selection =
    continued?.selection ||
    (task
      ? directSelection(task as TaskName, values.language, feedbackLanguage)
      : await wizard(input, textInput, {
          ...(values.language ? { language: values.language } : {}),
          ...(feedbackLanguage ? { feedbackLanguage } : {}),
        }));
  const out = await timed("Общее время", () =>
    pipeline({
      ...selection,
      input,
      textInput,
      out: values.out,
      model: continued?.model || values.model,
      sourceRun: continued?.sourceRun,
      transcriptSource: continued?.transcriptSource,
      cpu: !!values.cpu,
      keepWav: !!values["keep-wav"],
    }),
  );
  if (values.open) await openLocal(await ensureReport(out));
  return out;
}

export async function entry(args = Bun.argv.slice(2)) {
  try {
    await main(args);
  } catch (error) {
    if (error instanceof Cancelled) {
      console.log("Запуск отменён.");
      process.exitCode = 130;
      return;
    }
    console.error(
      `Ошибка: ${error instanceof Error ? error.message : "неизвестная ошибка"}`,
    );
    process.exitCode = 1;
  }
}
if (import.meta.main) await entry();
