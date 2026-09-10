import { constants } from "node:fs";
import { copyFile } from "node:fs/promises";
import { join } from "node:path";
import type { SavedRun } from "./history";
import { openLocal } from "./open";
import { inputFile } from "./transcribe";
import { ui, type WizardUI } from "./wizard";

export type ReviewedRun = {
  input: string;
  sourceRun: string;
  transcriptSource: "reviewed";
};

export async function reviewTranscript(
  run: SavedRun,
  prompts: WizardUI = ui,
  open: (path: string) => Promise<void> = openLocal,
): Promise<ReviewedRun | null> {
  if (!run.transcript) throw new Error("Исходный transcript.txt не найден.");

  const reviewed = join(run.directory, "transcript.reviewed.txt");
  try {
    await copyFile(run.transcript, reviewed, constants.COPYFILE_EXCL);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }

  prompts.show(
    "Открыл проверенную копию. Исправьте ошибки распознавания, сохраните файл и вернитесь в терминал. Исходный transcript.txt останется без изменений.",
    "Проверка транскрипта",
  );
  await open(reviewed);
  if (!(await prompts.confirm("Текст сохранён и готов к анализу?")))
    return null;

  await inputFile(reviewed);
  return {
    input: reviewed,
    sourceRun: run.directory,
    transcriptSource: "reviewed",
  };
}
