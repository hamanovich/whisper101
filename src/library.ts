import * as p from "@clack/prompts";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { Cancelled, ui, type WizardUI } from "./wizard";
import { existingFile, listHistory, type SavedRun } from "./history";
import { openLocal } from "./open";
import { ensureReport } from "./report";
import { taskNames, type Selection } from "./options";
import { inputFile } from "./transcribe";
import { reviewTranscript } from "./review";

export type ContinueRun = {
  input: string;
  sourceRun?: string;
  selection?: Selection;
  model?: string;
  transcriptSource?: "original" | "reviewed";
};
export function continuation(run: SavedRun, repeat: boolean): ContinueRun {
  const input =
    run.transcriptSource === "reviewed" && run.reviewedTranscript
      ? run.reviewedTranscript
      : run.transcript || run.reviewedTranscript;
  if (!input) throw new Error("Нет транскрипта. Обработайте аудиофайл заново.");
  return {
    input,
    sourceRun: run.directory,
    transcriptSource: run.transcriptSource,
    ...(repeat ? { selection: run.selection, model: run.model } : {}),
  };
}
export async function recent(
  prompts: WizardUI = ui,
  parent?: string,
): Promise<ContinueRun | null> {
  const runs = await listHistory(parent);
  if (!runs.length) {
    console.log("История пока пуста. Обработайте первый файл.");
    return null;
  }
  let page = 0;
  while (true) {
    const items = runs.slice(page * 15, (page + 1) * 15).map((run) => ({
      value: run.directory,
      label: `${run.title} · ${taskNames[run.selection.task]} · ${run.status === "failed" ? "ошибка" : run.status === "running" ? "не завершён" : run.status === "legacy" ? "архив" : "готово"}`,
    }));
    if ((page + 1) * 15 < runs.length)
      items.push({ value: "next", label: "Следующие записи →" });
    if (page > 0)
      items.push({ value: "previous", label: "← Предыдущие записи" });
    items.push({ value: "back", label: "Назад" });
    const selected = await prompts.pick(
      "Недавние записи",
      items,
      items[0]!.value,
    );
    if (selected === "back") return null;
    if (selected === "next") {
      page++;
      continue;
    }
    if (selected === "previous") {
      page--;
      continue;
    }
    const run = runs.find((item) => item.directory === selected);
    if (!run) throw new Error("Запись не найдена.");
    while (true) {
      const actions = [{ value: "report", label: "Открыть HTML-отчёт" }];
      if (run.audio)
        actions.push({ value: "audio", label: "Прослушать аудио" });
      if (run.transcript)
        actions.push(
          {
            value: "text",
            label: run.reviewedTranscript
              ? "Открыть исходный транскрипт"
              : "Открыть транскрипт",
          },
          ...(run.reviewedTranscript
            ? [
                {
                  value: "reviewed-text",
                  label: "Открыть проверенный транскрипт",
                },
              ]
            : []),
          {
            value: "review",
            label: run.reviewedTranscript
              ? "Продолжить проверку транскрипта"
              : "Проверить транскрипт перед анализом",
          },
          { value: "task", label: "Выполнить другую задачу по тексту" },
        );
      if (
        run.transcript &&
        run.selection.task !== "transcribe" &&
        run.status !== "running"
      )
        actions.push({
          value: "repeat",
          label:
            run.status === "failed"
              ? "Повторить неудавшийся анализ"
              : "Повторить анализ с теми же настройками",
        });
      actions.push(
        { value: "folder", label: "Открыть папку" },
        { value: "back", label: "К списку записей" },
      );
      const action = await prompts.pick(run.title, actions, "report");
      if (action === "back") break;
      if (action === "review") {
        const reviewed = await reviewTranscript(run, prompts);
        if (reviewed) return reviewed;
        run.reviewedTranscript = await existingFile(
          join(run.directory, "transcript.reviewed.txt"),
        );
      }
      if (action === "task") return continuation(run, false);
      if (action === "repeat") {
        prompts.show(
          `${taskNames[run.selection.task]} · ${run.selection.language} → ${run.selection.feedbackLanguage}\nТекст отправится в OpenAI. Результат сохранится в новой папке.`,
        );
        if (await prompts.confirm("Повторить анализ?"))
          return continuation(run, true);
      } else if (action === "report")
        await openLocal(await ensureReport(run.directory));
      else if (action === "audio" && run.audio) await openLocal(run.audio);
      else if (action === "text" && run.transcript)
        await openLocal(run.transcript);
      else if (action === "reviewed-text" && run.reviewedTranscript)
        await openLocal(run.reviewedTranscript);
      else if (action === "folder") await openLocal(run.directory);
    }
  }
}
export async function home(historyOnly = false): Promise<ContinueRun | null> {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error(
      "Главное меню требует интерактивный терминал. Укажите файл и --task для прямого запуска.",
    );
  p.intro("whisper101 · библиотека записей");
  if (historyOnly) return recent();
  while (true) {
    const action = await ui.pick(
      "С чего начнём?",
      [
        { value: "new", label: "Обработать новый файл" },
        { value: "history", label: "Открыть недавнюю запись" },
        { value: "exit", label: "Выйти" },
      ],
      "new",
    );
    if (action === "exit") return null;
    if (action === "history") {
      const selected = await recent();
      if (selected) return selected;
      continue;
    }
    const answer = await p.text({
      message: "Путь к аудиофайлу или .txt",
      placeholder: "~/Downloads/recording.m4a",
      validate: (value) =>
        value?.trim() ? undefined : "Введите путь к файлу.",
    });
    if (typeof answer !== "string") throw new Cancelled();
    let path = answer.trim().replace(/^(["'])(.*)\1$/, "$2");
    if (path.startsWith("~/")) path = `${homedir()}/${path.slice(2)}`;
    path = resolve(path);
    try {
      await inputFile(path);
      return { input: path };
    } catch (error) {
      console.log((error as Error).message);
    }
  }
}
