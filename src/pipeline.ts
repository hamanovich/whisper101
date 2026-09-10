import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { config, ROOT } from "./config";
import { createOutputDirectory } from "./output";
import { inputFile, transcribe } from "./transcribe";
import { recognitionScores, wavDuration } from "./recognition";
import { timed } from "./timing";
import { coach, coachMarkdown, coachSummary } from "./tasks/coach";
import { meeting } from "./tasks/meeting";
import { note } from "./tasks/note";
import { analyze } from "./analyze";
import type { RunOptions } from "./options";
import { ensureReport } from "./report";
import { existingFile } from "./history";

export async function pipeline(options: RunOptions) {
  const c = config();
  await inputFile(options.input);
  if (options.task !== "transcribe" && !c.apiKey)
    throw new Error(
      "Задайте OPENAI_API_KEY в .env. Без ключа доступен --task transcribe.",
    );
  let transcript = options.textInput
    ? await Bun.file(options.input).text()
    : "";
  if (options.textInput && !transcript.trim())
    throw new Error("Транскрипт пуст.");
  if (
    options.textInput &&
    options.task !== "transcribe" &&
    transcript.length > 100_000
  )
    throw new Error("Текст длиннее 100 000 символов. Разделите его на части.");
  let out: string;
  if (options.out) {
    out = resolve(options.out);
    await mkdir(resolve(out, ".."), { recursive: true });
    await mkdir(out).catch(() => {
      throw new Error(
        `Не удалось создать новую папку: ${out}. Укажите несуществующую папку.`,
      );
    });
  } else out = await createOutputDirectory(join(ROOT, "output"), options.input);
  const started = performance.now();
  const run = {
    task: options.task,
    input: options.input,
    inputType: options.textInput ? "text" : "audio",
    sourceRun: options.sourceRun || null,
    transcriptSource: options.transcriptSource || "original",
    requestedLanguage: options.language,
    detectedLanguage: null as string | null,
    feedbackLanguage:
      options.task === "transcribe" ? null : options.feedbackLanguage,
    whisperModel: options.textInput ? null : c.whisperModel,
    openaiModel:
      options.task === "transcribe" ? null : options.model || c.model,
    cpu: options.cpu,
    startedAt: new Date().toISOString(),
    finishedAt: null as string | null,
    status: "running",
    timingsSeconds: {} as Record<string, number>,
  };
  const saveRun = () =>
    writeFile(join(out, "run.json"), JSON.stringify(run, null, 2) + "\n");
  await saveRun();
  console.log(`Результаты: ${out}`);
  try {
    if (options.textInput) {
      if (options.transcriptSource === "reviewed") {
        if (!options.sourceRun)
          throw new Error(
            "Для проверенного транскрипта не указана исходная запись.",
          );
        const original = await existingFile(
          join(options.sourceRun, "transcript.txt"),
        );
        if (!original)
          throw new Error("Исходный transcript.txt больше недоступен.");
        await copyFile(original, join(out, "transcript.txt"));
        await writeFile(join(out, "transcript.reviewed.txt"), transcript, {
          flag: "wx",
        });
      } else
        await writeFile(join(out, "transcript.txt"), transcript, {
          flag: "wx",
        });
      if (options.sourceRun) {
        for (const name of ["audio.wav", "transcript.json"]) {
          const source = await existingFile(join(options.sourceRun, name));
          if (source) await copyFile(source, join(out, name));
        }
      }
    } else {
      const start = performance.now();
      try {
        transcript = await transcribe(
          options.input,
          out,
          options.language,
          options.keepWav,
          options.cpu,
          true,
        );
      } finally {
        run.timingsSeconds.transcription = (performance.now() - start) / 1000;
      }
    }
    console.log(
      `${options.transcriptSource === "reviewed" ? "Проверенный транскрипт" : "Транскрипт"}: ${join(out, options.transcriptSource === "reviewed" ? "transcript.reviewed.txt" : "transcript.txt")}`,
    );
    let scores = recognitionScores(null);
    if (!options.textInput || options.sourceRun) {
      try {
        scores = recognitionScores(
          await Bun.file(join(out, "transcript.json")).json(),
        );
      } catch {
        console.log("Диагностика Whisper недоступна; текст сохранён.");
      }
    }
    run.detectedLanguage = scores.language;
    const recognition = {
      ...scores,
      language:
        scores.language ||
        (options.language === "auto" ? null : options.language),
      durationSeconds:
        options.textInput && !options.sourceRun
          ? null
          : await wavDuration(join(out, "audio.wav")).catch(() => null),
    };
    if (options.task !== "transcribe") {
      console.log("Отправляю текст в OpenAI…");
      const start = performance.now();
      let feedback: string;
      try {
        feedback = await timed("Анализ OpenAI", async () => {
          if (options.task === "coach") {
            const data = await coach(
              transcript,
              c.apiKey!,
              run.openaiModel!,
              undefined,
              {
                ...options,
                language: recognition.language || options.language,
              },
            );
            await writeFile(
              join(out, "coach.json"),
              JSON.stringify({ recognition, ...data }, null, 2) + "\n",
              { flag: "wx" },
            );
            console.log(
              `\n${coachSummary(data, recognition, options.feedbackLanguage)}\n`,
            );
            return coachMarkdown(
              data,
              recognition,
              transcript,
              options.feedbackLanguage,
            );
          }
          if (options.task === "meeting")
            return meeting(transcript, options, c.apiKey!, run.openaiModel!);
          if (options.task === "note")
            return note(transcript, options, c.apiKey!, run.openaiModel!);
          return analyze(
            transcript,
            c.apiKey!,
            run.openaiModel!,
            undefined,
            options,
          );
        });
      } finally {
        run.timingsSeconds.analysis = (performance.now() - start) / 1000;
      }
      await writeFile(join(out, "feedback.md"), feedback, { flag: "wx" });
      console.log(`Разбор: ${join(out, "feedback.md")}`);
    }
    run.status = "completed";
    return out;
  } catch (error) {
    run.status = "failed";
    throw error;
  } finally {
    run.finishedAt = new Date().toISOString();
    run.timingsSeconds.total = (performance.now() - started) / 1000;
    await saveRun();
    try {
      console.log(`HTML-отчёт: ${await ensureReport(out)}`);
    } catch {
      console.warn(
        "HTML-отчёт не создан. Сохранённые файлы доступны в папке результата.",
      );
    }
  }
}
