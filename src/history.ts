import { readdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { ROOT } from "./config";
import { isTask, isFeedbackLanguage, type Selection } from "./options";

export type SavedRun = {
  directory: string;
  title: string;
  date: number;
  status: string;
  selection: Selection;
  model?: string;
  transcript: string | null;
  reviewedTranscript: string | null;
  transcriptSource: "original" | "reviewed";
  audio: string | null;
  feedback: string | null;
};
export async function existingFile(path: string) {
  const info = await stat(path).catch(() => null);
  return info?.isFile() && info.size > 0 ? path : null;
}
export async function readSavedRun(
  directory: string,
): Promise<SavedRun | null> {
  directory = resolve(directory);
  const [transcript, reviewedTranscript, audio, feedback] = await Promise.all([
    existingFile(join(directory, "transcript.txt")),
    existingFile(join(directory, "transcript.reviewed.txt")),
    existingFile(join(directory, "audio.wav")),
    existingFile(join(directory, "feedback.md")),
  ]);
  let metadata: Record<string, unknown> = {};
  try {
    const value = await Bun.file(join(directory, "run.json")).json();
    if (value && typeof value === "object" && !Array.isArray(value))
      metadata = value;
  } catch {}
  if (!transcript && !reviewedTranscript && !audio && !feedback) return null;
  const task =
    isTask(metadata.task) || metadata.task === "analyze"
      ? metadata.task
      : feedback
        ? "analyze"
        : "transcribe";
  const date =
    typeof metadata.startedAt === "string"
      ? Date.parse(metadata.startedAt)
      : NaN;
  const info = await stat(directory);
  return {
    directory,
    title: basename(directory),
    date: Number.isFinite(date) ? date : info.mtimeMs,
    status: ["completed", "failed", "running"].includes(String(metadata.status))
      ? String(metadata.status)
      : "legacy",
    selection: {
      task,
      language:
        typeof metadata.detectedLanguage === "string" &&
        /^[a-z]{2,3}$/.test(metadata.detectedLanguage)
          ? metadata.detectedLanguage
          : typeof metadata.requestedLanguage === "string" &&
              /^(auto|[a-z]{2,3})$/.test(metadata.requestedLanguage)
            ? metadata.requestedLanguage
            : "auto",
      feedbackLanguage: isFeedbackLanguage(metadata.feedbackLanguage)
        ? metadata.feedbackLanguage
        : "ru",
    },
    model:
      typeof metadata.openaiModel === "string" &&
      metadata.openaiModel.length < 200
        ? metadata.openaiModel
        : undefined,
    transcript,
    reviewedTranscript,
    transcriptSource:
      metadata.transcriptSource === "reviewed" && reviewedTranscript
        ? "reviewed"
        : "original",
    audio,
    feedback,
  };
}
export async function listHistory(parent = join(ROOT, "output")) {
  const directories = await readdir(parent, { withFileTypes: true }).catch(
    (error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  const runs = await Promise.all(
    directories
      .filter((item) => item.isDirectory())
      .map((item) => readSavedRun(join(parent, item.name)).catch(() => null)),
  );
  return runs
    .filter((run): run is SavedRun => run !== null)
    .sort((a, b) => b.date - a.date);
}
