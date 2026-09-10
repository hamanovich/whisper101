export const tasks = ["coach", "meeting", "note", "transcribe"] as const;
export type Task = (typeof tasks)[number];
export type TaskName = Task | "analyze";
export const feedbackLanguages = ["ru", "en", "pl"] as const;
export const models = [
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.6-sol",
  "gpt-6-astra",
] as const;
export const defaultModel = "gpt-5.6-terra";
export type FeedbackLanguage = (typeof feedbackLanguages)[number];
export const languageNames: Record<string, string> = {
  auto: "Определить автоматически",
  pl: "Польский",
  en: "Английский",
  ru: "Русский",
};
export const taskNames: Record<TaskName, string> = {
  coach: "Языковой тренер",
  meeting: "Конспект встречи",
  note: "Оформить голосовую заметку",
  transcribe: "Только транскрипция",
  analyze: "Разбор транскрипта",
};
export type Selection = {
  task: TaskName;
  language: string;
  feedbackLanguage: FeedbackLanguage;
};
export type RunOptions = Selection & {
  input: string;
  textInput: boolean;
  out?: string;
  model?: string;
  cpu: boolean;
  keepWav: boolean;
  sourceRun?: string;
  transcriptSource?: "original" | "reviewed";
};
export function isTask(value: unknown): value is Task {
  return tasks.includes(value as Task);
}
export function isFeedbackLanguage(value: unknown): value is FeedbackLanguage {
  return feedbackLanguages.includes(value as FeedbackLanguage);
}
export function isModelName(value: unknown): value is string {
  return typeof value === "string" && /^[\w.:-]{1,100}$/.test(value);
}

export function directSelection(
  task: TaskName,
  language?: string,
  feedbackLanguage?: FeedbackLanguage,
): Selection {
  return {
    task,
    language: language || (["coach", "analyze"].includes(task) ? "pl" : "auto"),
    feedbackLanguage: feedbackLanguage || "ru",
  };
}
