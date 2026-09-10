import { copyFile, rename, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import { readSavedRun, existingFile } from "./history";
import { plainDashes } from "./text";

export const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );
export function safeMarkdown(markdown: string) {
  return sanitizeHtml(marked.parse(plainDashes(markdown), { async: false }), {
    allowedTags: [
      "h1",
      "h2",
      "h3",
      "h4",
      "p",
      "br",
      "hr",
      "strong",
      "em",
      "del",
      "ul",
      "ol",
      "li",
      "blockquote",
      "pre",
      "code",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "a",
    ],
    allowedAttributes: { a: ["href", "rel"] },
    allowedSchemes: ["https", "http", "mailto"],
    allowProtocolRelative: false,
    transformTags: {
      a: (_tag, attributes) => ({
        tagName: "a",
        attribs: { ...attributes, rel: "noreferrer noopener" },
      }),
    },
  });
}

import { parseCoaching, type Coaching } from "./tasks/coach";
import { coachLocale } from "./locale";
import type { FeedbackLanguage } from "./options";

export const styles = readFileSync(
  new URL("./report.css", import.meta.url),
  "utf8",
);
const e = escapeHtml;

function coachingView(coach: Coaching, language: FeedbackLanguage) {
  const l = coachLocale(language);
  const words =
    language === "en"
      ? {
          before: "You said",
          after: "Try this",
          more: "Show all",
          grammar: "Make it clearer",
          intro:
            "Compare the phrases. Open the explanations when you need them.",
          natural: "Keep these phrases",
          vocabulary: "Take these with you",
          corrected: "Read the corrected version",
        }
      : language === "pl"
        ? {
            before: "W transkrypcji",
            after: "Lepsza wersja",
            more: "Pokaż wszystkie",
            grammar: "Powiedz to lepiej",
            intro: "Porównaj wyrażenia i przeczytaj wyjaśnienia.",
            natural: "Zachowaj te wyrażenia",
            vocabulary: "Zapamiętaj te słowa",
            corrected: "Przeczytaj poprawioną wersję",
          }
        : {
            before: "В транскрипте",
            after: "Лучше сказать",
            more: "Показать остальные",
            grammar: "Сказать точнее",
            intro: "Сравните формулировки и разберите, что изменилось.",
            natural: "Это уже получается",
            vocabulary: "Забрать в свой словарь",
            corrected: "Прочитать исправленный вариант",
          };
  const corrections = (items: Coaching["grammar_issues"]) =>
    items
      .map(
        (item) =>
          `<article class="correction"><div class="pair"><div class="phrase"><small>${e(words.before)}</small><p>${e(item.original)}</p></div><div class="phrase after"><small>${e(words.after)}</small><p>${e(item.corrected)}</p></div></div><p class="explanation">${e(item.explanation)}</p></article>`,
      )
      .join("");
  const stats = [
    ["natural", l.natural, coach.natural_phrases.length],
    [
      "grammar",
      language === "ru" ? "Грамматика" : l.grammar,
      coach.grammar_issues.length,
    ],
    [
      "formulations",
      language === "ru" ? "Формулировки" : l.formulations,
      coach.native_formulations.length,
    ],
    [
      "vocabulary",
      language === "ru" ? "Слова и выражения" : l.vocabulary,
      coach.vocabulary.length,
    ],
  ] as const;
  return `<div class="stats" aria-label="Выбранные примеры">${stats.map(([id, label, count]) => `<a class="stat" href="#${id}"><strong>${count}</strong><span>${e(label)}</span></a>`).join("")}</div>
<p class="notice">${e(l.notice)}</p>
<section class="section" id="grammar"><div class="section-head"><h2>${e(words.grammar)}<span class="count">${coach.grammar_issues.length}</span></h2><p>${e(words.intro)}</p></div>
${coach.grammar_issues.length ? corrections(coach.grammar_issues.slice(0, 3)) : `<p class="empty">${e(l.empty)}</p>`}
${coach.grammar_issues.length > 3 ? `<details class="more"><summary>${e(words.more)} (${coach.grammar_issues.length - 3})</summary>${corrections(coach.grammar_issues.slice(3))}</details>` : ""}</section>
<section class="section natural" id="natural"><h2>${e(words.natural)}<span class="count">${coach.natural_phrases.length}</span></h2>
${coach.natural_phrases.length ? coach.natural_phrases.map((item) => `<div class="natural-item"><blockquote>${e(item.phrase)}</blockquote><p>${e(item.reason)}</p></div>`).join("") : `<p>${e(l.empty)}</p>`}</section>
<section class="section" id="formulations"><div class="section-head"><h2>${e(l.formulations)}</h2></div>${corrections(coach.native_formulations) || `<p class="empty">${e(l.empty)}</p>`}</section>
<section class="section" id="vocabulary"><div class="section-head"><h2>${e(words.vocabulary)}</h2></div><div class="vocabulary">${coach.vocabulary.map((item) => `<article class="word"><h3>${e(item.word)}</h3><p>${e(item.translation)}</p><blockquote>${e(item.example)}</blockquote></article>`).join("") || `<p class="empty">${e(l.empty)}</p>`}</div></section>
<details class="text-disclosure"><summary>${e(words.corrected)}</summary><p class="reading">${e(coach.corrected_transcript)}</p></details>
<details class="uncertain"><summary>${e(l.review)}<span class="count">${coach.uncertain_passages.length}</span></summary>${coach.uncertain_passages.length ? `<ul>${coach.uncertain_passages.map((text) => `<li>${e(text)}</li>`).join("")}</ul>` : `<p>${e(l.empty)}</p>`}</details>`;
}

export function renderReport(data: {
  title: string;
  task: string;
  date: string;
  status: string;
  transcript: string;
  feedback: string;
  audio: boolean;
  reviewed: boolean;
  coaching?: Coaching;
  feedbackLanguage?: FeedbackLanguage;
  language?: string;
  durationSeconds?: number | null;
  diagnostics?: string;
}) {
  const status =
    (
      {
        completed: "Готово",
        failed: "Обработка не завершена",
        running: "Запуск не завершён",
        legacy: "Сохранённая запись",
      } as Record<string, string>
    )[data.status] || "Сохранённая запись";
  const languages: Record<string, string> = {
    pl: "Польский",
    en: "Английский",
    ru: "Русский",
  };
  const language = languages[data.language || ""] || data.language || "";
  const title = data.coaching
    ? language
      ? `${language}. Практика речи`
      : "Ваша практика речи"
    : data.task;
  const duration =
    typeof data.durationSeconds === "number" &&
    Number.isFinite(data.durationSeconds) &&
    data.durationSeconds >= 0
      ? `${Math.floor(data.durationSeconds / 60)}:${String(Math.floor(data.durationSeconds % 60)).padStart(2, "0")}`
      : "";
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; media-src 'self' file:; base-uri 'none'; form-action 'none'">
<title>${e(data.title)} · whisper101</title><style>${styles}</style></head>
<body><a class="skip" href="#feedback">Перейти к разбору</a><div class="shell">
<header class="topbar"><a class="brand" href="#top" aria-label="whisper101, начало отчёта">whisper<span>101</span></a><nav aria-label="Навигация по отчёту"><a href="#feedback">Разбор</a><a href="#transcript">Транскрипт</a><a class="download" href="${data.reviewed ? "transcript.reviewed.txt" : "transcript.txt"}" download>Скачать текст</a></nav></header>
<main id="top"><header class="hero"><div class="eyebrow">${data.coaching ? "Language Coach" : "Ваша запись"}</div><h1>${e(title)}</h1><p class="subtitle">${data.coaching ? "Замечайте удачные фразы. Находите слова точнее." : "Всё важное из записи, собранное в одном месте."}</p><div class="filemeta"><span class="filename">${e(data.title)}</span><span>${e(data.date)}</span><span class="status">${status}</span>${data.reviewed ? '<span class="status">Проверенный текст</span>' : ""}</div></header>
${data.status === "failed" || data.status === "running" ? '<div class="status-warning">Анализ мог не завершиться. Можно повторить его из истории в CLI; сохранённый транскрипт остаётся доступен.</div>' : ""}
<div class="workspace"><div class="main-column" id="feedback">${data.coaching ? coachingView(data.coaching, data.feedbackLanguage || "ru") : `<section class="section"><h2>Разбор записи</h2><div class="content">${data.feedback ? safeMarkdown(data.feedback) : '<p class="empty">Разбора пока нет. Выберите задачу для этой записи в истории CLI.</p>'}</div></section>`}</div>
<aside class="sidebar" aria-label="Запись и исходный текст"><section class="player"><h2 class="player-title">Ваша запись</h2>${data.audio ? '<p>Послушайте ещё раз, уже с подсказками.</p><audio aria-label="Исходное аудио" controls preload="metadata" src="audio.wav">Ваш браузер не поддерживает аудиоплеер.</audio>' : "<p>В этой папке нет аудио. Отчёт сформирован по сохранённому тексту.</p>"}<div class="audio-meta">${duration ? `<span>${duration}</span>` : ""}${language ? `<span>${e(language)}</span>` : ""}</div></section>
<section class="transcript-panel" id="transcript"><details><summary>${data.reviewed ? "Проверенный транскрипт" : "Транскрипт"}</summary><p class="reading" tabindex="0" aria-label="Текст записи">${e(data.transcript || "Транскрипт ещё не создан.")}</p></details><p>${data.reviewed ? "Использован в этом разборе. Исходный текст сохранён отдельно." : "Исходный текст для сверки с аудио."}</p></section>
<div class="guide"><h3>Как читать разбор</h3><p>Сверяйте спорные места с записью. Whisper может менять слова. Разбор оценивает текст, а не произношение.</p></div>${data.diagnostics ? `<details class="diagnostics"><summary>Диагностика распознавания</summary><p>${e(data.diagnostics)}</p></details>` : ""}</aside></div></main>
<footer><span>whisper101 / Локальный отчёт</span><span>Для переноса вместе с аудио скопируйте всю папку записи.</span></footer></div></body></html>`;
}

export async function ensureReport(
  directory: string,
  options: { refresh?: boolean } = {},
) {
  const path = join(directory, "report.html");
  if (!options.refresh && (await existingFile(path))) return path;
  const run = await readSavedRun(directory);
  if (!run)
    throw new Error("В папке нет аудио, транскрипта или разбора для отчёта.");
  const { taskNames } = await import("./options");
  let coaching: Coaching | undefined;
  let durationSeconds: number | null = null;
  let diagnostics: string | undefined;
  try {
    const { recognition, ...raw } = await Bun.file(
      join(directory, "coach.json"),
    ).json();
    if (run.selection.task === "coach")
      coaching = parseCoaching(plainDashes(JSON.stringify(raw)));
    durationSeconds = recognition?.durationSeconds ?? null;
    const mean = recognition?.meanTokenProbability;
    const low = recognition?.lowProbabilityTokens;
    const total = recognition?.scoredTokens;
    if (
      typeof mean === "number" &&
      Number.isFinite(mean) &&
      mean >= 0 &&
      mean <= 1 &&
      Number.isInteger(low) &&
      Number.isInteger(total) &&
      low >= 0 &&
      total >= low
    )
      diagnostics = `Средняя оценка токенов Whisper: ${mean.toFixed(2)}. Ниже 0.50: ${low}/${total}. Это не процент точности. Оценки относятся к исходному распознаванию, включая случаи ручной проверки текста.`;
  } catch {}
  const html = renderReport({
    title: run.title,
    task: taskNames[run.selection.task],
    status: run.status,
    date: new Date(run.date).toLocaleString("ru-RU"),
    audio: !!run.audio,
    reviewed: run.transcriptSource === "reviewed",
    transcript:
      run.transcriptSource === "reviewed" && run.reviewedTranscript
        ? await Bun.file(run.reviewedTranscript).text()
        : run.transcript
          ? await Bun.file(run.transcript).text()
          : "",
    feedback: run.feedback ? await Bun.file(run.feedback).text() : "",
    coaching,
    feedbackLanguage: run.selection.feedbackLanguage,
    language:
      run.selection.language === "auto" ? undefined : run.selection.language,
    durationSeconds,
    diagnostics,
  });
  if (options.refresh) {
    if (await existingFile(path))
      await copyFile(
        path,
        join(directory, `report.backup-${crypto.randomUUID()}.html`),
      );
    const temporary = join(directory, `report.${crypto.randomUUID()}.tmp`);
    await writeFile(temporary, html, { flag: "wx" });
    await rename(temporary, path);
  } else {
    try {
      await writeFile(path, html, { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  return path;
}
