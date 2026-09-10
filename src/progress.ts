import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ROOT } from "./config";
import { listHistory } from "./history";
import { wavDuration } from "./recognition";
import { escapeHtml, styles } from "./report";
import { plainDashes } from "./text";

export type Repeat = {
  from: string;
  to: string;
  explanation: string;
  count: number;
  last: number;
};
export type Word = {
  word: string;
  translation: string;
  example: string;
  count: number;
};
export type Week = { label: string; runs: number; minutes: number };
export type Progress = {
  runs: number;
  coached: number;
  seconds: number;
  first: number | null;
  last: number | null;
  languages: string[];
  phrases: number;
  corrections: Repeat[];
  words: Repeat[];
  vocabulary: Word[];
  weeks: Week[];
  confidence: number | null;
};

export const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

export function changedWords(original: string, corrected: string) {
  const before = normalize(original).split(" ").filter(Boolean);
  const after = normalize(corrected).split(" ").filter(Boolean);
  const missing = (source: string[], other: string[]) => {
    const rest = [...other];
    const result: string[] = [];
    for (const word of source) {
      const index = rest.indexOf(word);
      if (index === -1) result.push(word);
      else rest.splice(index, 1);
    }
    return result;
  };
  return { removed: missing(before, after), added: missing(after, before) };
}

function startOfWeek(time: number) {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date.getTime();
}

function weekLabel(time: number) {
  const date = new Date(time);
  return `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function texts<K extends string>(
  value: unknown,
  keys: readonly K[],
): Record<K, string>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Record<K, string> =>
      !!item &&
      typeof item === "object" &&
      keys.every(
        (key) => typeof (item as Record<string, unknown>)[key] === "string",
      ),
  );
}

export async function collectProgress(parent?: string): Promise<Progress> {
  const history = await listHistory(parent);
  const corrections = new Map<string, Repeat>();
  const words = new Map<string, Repeat>();
  const vocabulary = new Map<string, Word>();
  const activity = new Map<number, Week>();
  const languages = new Set<string>();
  const scores: number[] = [];
  let seconds = 0;
  let coached = 0;
  let phrases = 0;
  for (const run of history) {
    const duration = run.audio
      ? await wavDuration(run.audio).catch(() => null)
      : null;
    seconds += duration || 0;
    if (run.selection.language !== "auto")
      languages.add(run.selection.language);
    const monday = startOfWeek(run.date);
    const week = activity.get(monday) || {
      label: weekLabel(monday),
      runs: 0,
      minutes: 0,
    };
    week.runs++;
    week.minutes += (duration || 0) / 60;
    activity.set(monday, week);
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(
        plainDashes(await Bun.file(join(run.directory, "coach.json")).text()),
      );
    } catch {
      continue;
    }
    if (!data || typeof data !== "object") continue;
    coached++;
    const recognition = data.recognition as Record<string, unknown> | undefined;
    const mean = recognition?.meanTokenProbability;
    if (typeof mean === "number" && mean >= 0 && mean <= 1) scores.push(mean);
    phrases += texts(data.natural_phrases, ["phrase", "reason"]).length;
    for (const issue of texts(data.grammar_issues, [
      "original",
      "corrected",
      "explanation",
    ])) {
      const key = `${normalize(issue.original)}→${normalize(issue.corrected)}`;
      if (!key.replace("→", "").trim()) continue;
      const found = corrections.get(key) || {
        from: issue.original,
        to: issue.corrected,
        explanation: issue.explanation,
        count: 0,
        last: run.date,
      };
      found.count++;
      found.last = Math.max(found.last, run.date);
      corrections.set(key, found);
      const { removed, added } = changedWords(issue.original, issue.corrected);
      if (!removed.length || !added.length || removed.length > 3) continue;
      const wordKey = removed.join(" ");
      const repeat = words.get(wordKey) || {
        from: wordKey,
        to: added.join(" "),
        explanation: issue.explanation,
        count: 0,
        last: run.date,
      };
      repeat.count++;
      repeat.last = Math.max(repeat.last, run.date);
      words.set(wordKey, repeat);
    }
    for (const item of texts(data.vocabulary, [
      "word",
      "translation",
      "example",
    ])) {
      const key = normalize(item.word);
      if (!key) continue;
      const found = vocabulary.get(key) || {
        word: item.word,
        translation: item.translation,
        example: item.example,
        count: 0,
      };
      found.count++;
      vocabulary.set(key, found);
    }
  }
  const weeks: Week[] = [];
  const mondays = [...activity.keys()].sort((a, b) => a - b);
  const week = 7 * 24 * 3600 * 1000;
  for (
    let time = mondays[0] ?? 0;
    mondays.length && time <= mondays[mondays.length - 1]!;
    time = startOfWeek(time + week + 3600 * 1000)
  )
    weeks.push(
      activity.get(time) || { label: weekLabel(time), runs: 0, minutes: 0 },
    );
  const byCount = (a: Repeat, b: Repeat) =>
    b.count - a.count || b.last - a.last;
  return {
    runs: history.length,
    coached,
    seconds,
    first: history.length ? history[history.length - 1]!.date : null,
    last: history.length ? history[0]!.date : null,
    languages: [...languages],
    phrases,
    corrections: [...corrections.values()]
      .filter((item) => item.count > 1)
      .sort(byCount)
      .slice(0, 12),
    words: [...words.values()]
      .filter((item) => item.count > 1)
      .sort(byCount)
      .slice(0, 15),
    vocabulary: [...vocabulary.values()].sort(
      (a, b) => b.count - a.count || a.word.localeCompare(b.word),
    ),
    weeks: weeks.slice(-12),
    confidence: scores.length
      ? scores.reduce((a, b) => a + b, 0) / scores.length
      : null,
  };
}

export function plural(count: number, one: string, few: string, many: string) {
  const tens = count % 100;
  if (tens > 10 && tens < 20) return `${count} ${many}`;
  const last = count % 10;
  if (last === 1) return `${count} ${one}`;
  if (last > 1 && last < 5) return `${count} ${few}`;
  return `${count} ${many}`;
}

const day = (time: number | null) =>
  time === null ? "" : new Date(time).toLocaleDateString("ru-RU");

export function progressSummary(progress: Progress) {
  const minutes = Math.round(progress.seconds / 60);
  return `📈 Записей: ${progress.runs} (с разбором: ${progress.coached}) · практика: ${minutes} мин\n🗓 ${day(progress.first)} - ${day(progress.last)}\n⚠ Повторяющихся ошибок: ${progress.corrections.length}\n🔁 Слов с повторными исправлениями: ${progress.words.length}\n📚 Слов в словаре: ${progress.vocabulary.length}`;
}

const e = escapeHtml;

function repeats(items: Repeat[], before: string, after: string) {
  if (!items.length)
    return '<p class="empty">Повторов пока нет. Нужно несколько записей с разбором.</p>';
  return items
    .map(
      (item) =>
        `<article class="correction"><div class="pair"><div class="phrase"><small>${e(before)}</small><p>${e(item.from)}</p></div><div class="phrase after"><small>${e(after)}</small><p>${e(item.to)}</p></div></div><p class="explanation"><span class="times">${item.count}×</span>${e(item.explanation)}</p></article>`,
    )
    .join("");
}

export function renderProgress(progress: Progress) {
  const minutes = Math.round(progress.seconds / 60);
  const peak = Math.max(1, ...progress.weeks.map((item) => item.runs));
  const chart = progress.weeks.length
    ? `<div class="chart">${progress.weeks
        .map(
          (item) =>
            `<div class="column"><span class="bar" style="height:${Math.round((120 * item.runs) / peak) || 2}px"></span><span class="value">${item.runs}</span><span class="label">${e(item.label)}</span></div>`,
        )
        .join("")}</div>`
    : '<p class="empty">Нет записей для графика.</p>';
  const stats = [
    ["weeks", "Записей", String(progress.runs)],
    ["weeks", "Минут практики", String(minutes)],
    ["repeats", "Повторяющихся ошибок", String(progress.corrections.length)],
    ["vocabulary", "Слов в словаре", String(progress.vocabulary.length)],
  ] as const;
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Прогресс · whisper101</title><style>${styles}</style></head>
<body><a class="skip" href="#repeats">Перейти к повторяющимся ошибкам</a><div class="shell">
<header class="topbar"><a class="brand" href="#top" aria-label="whisper101, начало страницы">whisper<span>101</span></a><nav aria-label="Навигация по странице"><a href="#weeks">Активность</a><a href="#repeats">Ошибки</a><a href="#vocabulary">Словарь</a></nav></header>
<main id="top"><header class="hero"><div class="eyebrow">Прогресс</div><h1>${plural(minutes, "минута", "минуты", "минут")} практики</h1><p class="subtitle">Что повторяется от записи к записи и какие слова уже накопились.</p><div class="filemeta"><span class="filename">${plural(progress.runs, "запись", "записи", "записей")}</span>${progress.first ? `<span>${e(day(progress.first))} - ${e(day(progress.last))}</span>` : ""}${progress.languages.length ? `<span class="status">${e(progress.languages.join(", "))}</span>` : ""}</div></header>
<div class="stats" aria-label="Сводка по всем записям">${stats.map(([id, label, value]) => `<a class="stat" href="#${id}"><strong>${e(value)}</strong><span>${e(label)}</span></a>`).join("")}</div>
<p class="notice">Счётчики построены по сохранённым разборам, а не по оценке уровня языка. Ошибки могут принадлежать распознаванию: спорные места сверяйте с исходной записью.</p>
<div class="workspace"><div class="main-column">
<section class="section" id="weeks"><div class="section-head"><h2>Активность по неделям</h2><p>Число записей за неделю. Пустые недели показаны как пропуски.</p></div>${chart}</section>
<section class="section" id="repeats"><div class="section-head"><h2>Повторяющиеся ошибки<span class="count">${progress.corrections.length}</span></h2><p>Одно и то же исправление встретилось в нескольких записях.</p></div>${repeats(progress.corrections, "Вы сказали", "Лучше сказать")}</section>
<section class="section" id="words"><div class="section-head"><h2>Слова, которые исправляют чаще всего<span class="count">${progress.words.length}</span></h2><p>Здесь сравниваются отдельные слова, поэтому повтор виден даже в разных фразах.</p></div>${repeats(progress.words, "В речи", "Правильно")}</section>
<section class="section" id="vocabulary"><div class="section-head"><h2>Накопленный словарь<span class="count">${progress.vocabulary.length}</span></h2><p>Слова из всех разборов Coach, без повторов.</p></div><div class="vocabulary">${progress.vocabulary.map((item) => `<article class="word"><h3>${e(item.word)}${item.count > 1 ? `<span class="count">${item.count}×</span>` : ""}</h3><p>${e(item.translation)}</p><blockquote>${e(item.example)}</blockquote></article>`).join("") || '<p class="empty">Словарь появится после первого разбора Coach.</p>'}</div></section>
</div>
<aside class="sidebar" aria-label="Итоги"><section class="player"><h2 class="player-title">Коротко</h2><p>Записей с разбором: ${progress.coached} из ${progress.runs}. Удачных фраз отмечено: ${progress.phrases}.</p><div class="audio-meta"><span>${minutes} мин</span><span>${plural(progress.vocabulary.length, "слово", "слова", "слов")}</span></div></section>
<div class="guide"><h3>Как читать</h3><p>Повтор в списке означает, что модель исправляла это несколько раз в разных записях. Это подсказка, что повторить, а не оценка уровня.</p></div>
${progress.confidence !== null ? `<details class="diagnostics"><summary>Диагностика распознавания</summary><p>Средняя оценка токенов Whisper по всем разборам: ${progress.confidence.toFixed(2)}. Это не процент точности и не оценка произношения.</p></details>` : ""}</aside></div></main>
<footer><span>whisper101 / Локальная сводка</span><span>Страница строится по папкам в output и обновляется при каждом запуске.</span></footer></div></body></html>`;
}

export async function writeProgress(parent = join(ROOT, "output")) {
  const progress = await collectProgress(parent);
  if (!progress.runs)
    throw new Error("История пуста. Обработайте первую запись.");
  console.log(`\n${progressSummary(progress)}\n`);
  const path = join(parent, "progress.html");
  const temporary = join(parent, `progress.${crypto.randomUUID()}.tmp`);
  await writeFile(temporary, renderProgress(progress), { flag: "wx" });
  await rename(temporary, path);
  console.log(`Сводка: ${path}`);
  return path;
}
