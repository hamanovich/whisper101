import { parseArgs } from "node:util";
import { resolve, extname } from "node:path";
import { config } from "./config";
import { executable, inputFile } from "./transcribe";
import { timed } from "./timing";
import { pipeline } from "./pipeline";
import { Cancelled, modelSources, preferredModel, wizard } from "./wizard";
import { audioDevices, audioInput, record } from "./record";
import { writeProgress } from "./progress";
import { home, settings } from "./library";
import { ensureReport } from "./report";
import { openLocal } from "./open";
import {
  directSelection,
  isTask,
  isFeedbackLanguage,
  type FeedbackLanguage,
  type TaskName,
} from "./options";

const help = `whisper101 - аудио и текст → выбранная задача

bun start                                  Новый файл, запись или история
bun start record                           Записать с микрофона и обработать
bun start history                          Открыть историю записей
bun start progress                         Сводка прогресса по всем записям
bun start settings                         Выбрать модель OpenAI
bun start report output/<папка>            Создать/открыть локальный HTML-отчёт
bun start recording.m4a                    Интерактивный мастер
bun start transcript.txt                   Задание по готовому тексту
bun start file.m4a --task meeting          Прямой запуск без опросника
bun run coach file.m4a                     Короткий запуск тренера (pl → ru)
bun run transcribe file.m4a                Только локальное распознавание
bun run analyze transcript.txt             Прежний текстовый разбор
bun run doctor                             Проверка окружения без API-запроса

--task coach|meeting|note|transcribe       Задача; без параметра открывается мастер
--language auto|pl|en|ru|…                 Язык записи; для .txt - подсказка модели
--feedback-language ru|en|pl               Язык результата (по умолчанию ru)
--device NAME                              Устройство записи для record
--out DIR                                  Новая папка результатов
--model NAME                               Модель OpenAI на один запуск
--cpu                                      Whisper без GPU
--keep-wav                                 Сохранить audio.wav (по умолчанию)
--open                                     Открыть HTML-отчёт после обработки
--refresh                                  Для report: обновить HTML, сохранив копию
--help                                     Справка

Модель для анализа выбирается в «Настройках»; --model меняет её на один запуск.
Во время записи: пробел - пауза и продолжение, Enter - остановить.
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
      device: { type: "string" },
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
      "record",
      "progress",
      "settings",
    ].includes(positionals[0] || "")
  )
    command = positionals.shift()!;
  if (values.help) return { command: "help", values, file: undefined };
  const menu = command === "run" && args.length === 0;
  if (values.refresh && command !== "report")
    throw new Error("--refresh доступен только для команды report.");
  if (values.device !== undefined && command !== "record")
    throw new Error("--device доступен только для команды record.");
  const expected =
    ["doctor", "history", "record", "progress", "settings"].includes(command) ||
    menu
      ? 0
      : 1;
  if (positionals.length !== expected)
    throw new Error(
      expected === 0
        ? `Команда ${command} не принимает входной файл. Справка: bun run start --help`
        : "Укажите один входной файл. Справка: bun run start --help",
    );
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
  if (
    values.task &&
    !["run", "history", "record", "progress", "settings"].includes(command) &&
    command !== values.task
  )
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
  const audio = audioInput();
  if (!audio.format) console.log("Микрофон: запись доступна на macOS и Linux.");
  else {
    const devices = await audioDevices().catch(() => []);
    console.log(
      `Микрофон: ${audio.format} / ${audio.device}${devices.length ? `; найдено: ${devices.map((item) => `${item.id} ${item.name}`).join(", ")}` : ""}`,
    );
  }
  const model = await preferredModel();
  console.log(
    `OpenAI key: ${c.apiKey ? "задан" : "не задан (локальная транскрипция доступна)"}`,
  );
  console.log(`OpenAI model: ${model.model} (${modelSources[model.source]})`);
}

export async function main(args = Bun.argv.slice(2)) {
  const { command, values, file } = argumentsFor(args);
  if (command === "help") return console.log(help);
  if (command === "doctor") return doctor();
  if (command === "progress") return openLocal(await writeProgress());
  if (command === "settings") {
    if (!process.stdin.isTTY || !process.stdout.isTTY)
      throw new Error(
        "Настройки требуют интерактивный терминал. Для одного запуска используйте --model.",
      );
    return settings();
  }
  if (command === "report")
    return openLocal(
      await ensureReport(resolve(file!), { refresh: values.refresh }),
    );
  const chosen =
    command === "history" || (!file && command !== "record")
      ? await home(command === "history")
      : undefined;
  if (chosen === null) return;
  const recording = command === "record" || (!!chosen && "record" in chosen);
  const continued = chosen && "record" in chosen ? undefined : chosen;
  const input = recording ? null : resolve(continued?.input || file!);
  if (input) await inputFile(input);
  const textInput =
    !!input &&
    (extname(input).toLowerCase().endsWith(".txt") || command === "analyze");
  const task =
    continued?.selection?.task ||
    values.task ||
    (["run", "history", "record"].includes(command)
      ? undefined
      : (command as TaskName));
  const feedbackLanguage = values["feedback-language"] as
    FeedbackLanguage | undefined;
  const selection =
    continued?.selection ||
    (task
      ? directSelection(task as TaskName, values.language, feedbackLanguage)
      : await wizard(
          input || "Запись с микрофона",
          textInput,
          {
            ...(values.language ? { language: values.language } : {}),
            ...(feedbackLanguage ? { feedbackLanguage } : {}),
          },
          recording,
        ));
  const model = continued?.model || (await preferredModel(values.model)).model;
  const recorded = recording ? await record(values.device) : null;
  try {
    const out = await timed("Общее время", () =>
      pipeline({
        ...selection,
        input: recorded?.path || input!,
        textInput,
        out: values.out,
        model,
        sourceRun: continued?.sourceRun,
        transcriptSource: continued?.transcriptSource,
        cpu: !!values.cpu,
        keepWav: !!values["keep-wav"],
      }),
    );
    await recorded?.discard();
    if (values.open) await openLocal(await ensureReport(out));
    return out;
  } catch (error) {
    if (recorded) console.error(`Исходная запись сохранена: ${recorded.path}`);
    throw error;
  }
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
