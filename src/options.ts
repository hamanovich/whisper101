export const tasks = ["coach", "meeting", "note", "transcribe"] as const;
export type Task = (typeof tasks)[number];
export type TaskName = Task | "analyze";
export const feedbackLanguages = ["ru", "en", "pl"] as const;
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
