import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { config } from "./config";
import { outputDirectory } from "./output";
import { readPcm, wavHeader } from "./record";
import { executable, inputFile } from "./transcribe";
import { formatDuration, timed } from "./timing";
import { plural } from "./progress";

export type Word = {
  term: string;
  translation: string;
  example: string;
  exampleTranslation: string;
  learningLanguage: string;
  translationLanguage: string;
  srsBox: number;
  dueAt: string;
  learnedAt: string;
};
export type Step = {
  text: string;
  language: string;
  learning: boolean;
  pause: number;
};
export type ListenOptions = {
  due?: boolean;
  slow?: boolean;
  reverse?: boolean;
};

export const voices: Record<string, string> = {
  pl: "pl_PL-mc_speech-medium",
  ru: "ru_RU-ruslan-medium",
  en: "en_US-lessac-medium",
  de: "de_DE-thorsten-medium",
};
const languageNames: Record<string, string> = {
  polish: "pl",
  russian: "ru",
  english: "en",
  german: "de",
};
const required = [
  "term",
  "translation",
  "learningLanguage",
  "translationLanguage",
];

export function languageCode(value: string) {
  const name = value.trim().toLowerCase();
  return languageNames[name] || (/^[a-z]{2}$/.test(name) ? name : null);
}

export function voiceFor(code: string) {
  return process.env[`PIPER_VOICE_${code.toUpperCase()}`] || voices[code];
}

export function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  text = text.replace(/^﻿/, "");
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && !field) quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (quoted) throw new Error("CSV повреждён: незакрытая кавычка.");
  if (field || row.length) rows.push([...row, field]);
  return rows.filter((item) => item.some((value) => value.trim()));
}

export function readVocabulary(text: string): Word[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) throw new Error("CSV пуст.");
  const names = header.map((name) => name.trim());
  const missing = required.filter((name) => !names.includes(name));
  if (missing.length)
    throw new Error(`В CSV нет колонок: ${missing.join(", ")}.`);
  return rows
    .map((row) => {
      const value = (name: string) =>
        (row[names.indexOf(name)] ?? "").replace(/\s+/g, " ").trim();
      return {
        term: value("term"),
        translation: value("translation"),
        example: value("example"),
        exampleTranslation: value("exampleTranslation"),
        learningLanguage: value("learningLanguage"),
        translationLanguage: value("translationLanguage"),
        srsBox: Number.parseInt(value("srsBox"), 10) || 0,
        dueAt: value("dueAt"),
        learnedAt: value("learnedAt"),
      };
    })
    .filter((word) => word.term && word.translation);
}

export function dueWords(words: Word[], now = new Date()) {
  return words.filter(
    (word) =>
      !word.learnedAt &&
      (!word.dueAt || !(Date.parse(word.dueAt) > now.getTime())),
  );
}

export function cardSteps(word: Word, options: ListenOptions = {}): Step[] {
  const learning = languageCode(word.learningLanguage);
  const native = languageCode(word.translationLanguage);
  if (!learning || !native)
    throw new Error(
      `Неизвестный язык у слова «${word.term}»: ${learning ? word.translationLanguage : word.learningLanguage}.`,
    );
  const think = options.slow ? 4 : 2.5;
  const short = options.slow ? 1.5 : 0.8;
  const term = { text: word.term, language: learning, learning: true };
  const translation = {
    text: word.translation,
    language: native,
    learning: false,
  };
  const steps: Step[] = options.reverse
    ? [
        { ...translation, pause: think },
        { ...term, pause: short },
      ]
    : [
        { ...term, pause: think },
        { ...translation, pause: short },
      ];
  if (word.example)
    steps.push({
      text: word.example,
      language: learning,
      learning: true,
      pause: short,
    });
  if (word.exampleTranslation)
    steps.push({
      text: word.exampleTranslation,
      language: native,
      learning: false,
      pause: short,
    });
  steps[steps.length - 1]!.pause = think;
  return steps;
}

export function lengthScale(learning: boolean, slow = false) {
  return learning ? (slow ? 1.35 : 1.1) : slow ? 1.15 : 1;
}

function slug(text: string) {
  return (
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "word"
  );
}

async function spawnChecked(command: string[], label: string, input?: string) {
  const child = Bun.spawn(command, {
    stdin: input === undefined ? "ignore" : "pipe",
    stdout: "ignore",
    stderr: "pipe",
  });
  if (input !== undefined && child.stdin) {
    child.stdin.write(input);
    child.stdin.end();
  }
  const [code, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]);
  if (code !== 0)
    throw new Error(`${label}: код ${code}.\n${stderr.slice(-2500)}`);
}

async function voiceRate(model: string) {
  await inputFile(model).catch(() => {
    throw new Error(
      `Не найден голос Piper: ${model}. Скачайте его: uv tool run --from piper-tts python -m piper.download_voices ${basename(model, ".onnx")} --data-dir ${join(model, "..")}`,
    );
  });
  const settings = await Bun.file(`${model}.json`)
    .json()
    .catch(() => null);
  const rate = settings?.audio?.sample_rate;
  if (!Number.isInteger(rate) || rate <= 0)
    throw new Error(`Не удалось прочитать частоту голоса: ${model}.json`);
  return rate as number;
}

async function synthesize(
  piper: string,
  model: string,
  scale: number,
  texts: string[],
  directory: string,
) {
  await mkdir(directory);
  await spawnChecked(
    [
      piper,
      "-m",
      model,
      "-d",
      directory,
      "--output-dir-naming",
      "timestamp",
      "--length-scale",
      String(scale),
    ],
    "Piper",
    texts.join("\n") + "\n",
  );
  const order = (name: string) => BigInt(name.slice(0, -4));
  const files = (await readdir(directory))
    .filter((name) => /^\d+\.wav$/.test(name))
    .sort((a, b) => (order(a) < order(b) ? -1 : order(a) > order(b) ? 1 : 0));
  if (files.length !== texts.length)
    throw new Error(
      `Piper озвучил ${files.length} фраз из ${texts.length}. Проверьте голос ${model}.`,
    );
  return Promise.all(
    files.map(async (name) => {
      const pcm = await readPcm(join(directory, name));
      if (!pcm) throw new Error(`Piper создал повреждённый файл: ${name}`);
      return pcm;
    }),
  );
}

async function encode(
  ffmpeg: string,
  pcm: Buffer,
  rate: number,
  temp: string,
  target: string,
  title: string,
) {
  const wav = join(temp, "encode.wav");
  await Bun.write(wav, Buffer.concat([wavHeader(pcm.length, rate), pcm]));
  await spawnChecked(
    [
      ffmpeg,
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-n",
      "-i",
      wav,
      "-c:a",
      "aac",
      "-b:a",
      "64k",
      "-metadata",
      `title=${title}`,
      target,
    ],
    "Кодирование ffmpeg",
  );
}

export async function listen(
  input: string,
  options: ListenOptions & { out?: string } = {},
) {
  const c = config();
  await inputFile(input);
  const ffmpeg = await executable(c.ffmpeg);
  const piper = await executable(c.piper).catch(() => {
    throw new Error(
      `Не найден Piper (${c.piper}). Установите: uv tool install --python 3.12 piper-tts`,
    );
  });
  const all = readVocabulary(await Bun.file(input).text());
  const words = options.due ? dueWords(all) : all;
  console.log(
    `Слов в словаре: ${all.length}${options.due ? `; к повторению: ${words.length}` : ""}`,
  );
  if (!words.length)
    throw new Error(
      options.due
        ? "Сейчас нет слов к повторению. Запустите без --due, чтобы прослушать весь словарь."
        : "В CSV нет слов с переводом.",
    );
  const cards = words.map((word) => ({
    word,
    steps: cardSteps(word, options),
  }));
  const groups = new Map<
    string,
    { model: string; scale: number; texts: string[] }
  >();
  const models = new Map<string, string>();
  for (const step of cards.flatMap((card) => card.steps)) {
    const voice = voiceFor(step.language);
    if (!voice)
      throw new Error(
        `Нет голоса Piper для языка ${step.language}. Задайте PIPER_VOICE_${step.language.toUpperCase()} в .env.`,
      );
    const model = join(c.piperVoices, `${voice}.onnx`);
    models.set(step.language, model);
    const scale = lengthScale(step.learning, options.slow);
    const key = `${model}|${scale}`;
    const group = groups.get(key) || { model, scale, texts: [] };
    if (!group.texts.includes(step.text)) group.texts.push(step.text);
    groups.set(key, group);
  }
  const rates = new Set(
    await Promise.all([...new Set(models.values())].map(voiceRate)),
  );
  if (rates.size !== 1)
    throw new Error(
      "Голоса Piper должны иметь одинаковую частоту дискретизации.",
    );
  const rate = [...rates][0]!;
  const silence = (seconds: number) =>
    Buffer.alloc(Math.round(rate * seconds) * 2);
  const out = await outputDirectory(input, options.out);
  console.log(`Результаты: ${out}`);
  const temp = await mkdtemp(join(tmpdir(), "whisper101-listen-"));
  try {
    const audio = new Map<string, Buffer>();
    let index = 0;
    for (const [key, group] of groups) {
      const pcm = await timed(
        `Озвучка ${basename(group.model, ".onnx")}: ${plural(group.texts.length, "фраза", "фразы", "фраз")}`,
        () =>
          synthesize(
            piper,
            group.model,
            group.scale,
            group.texts,
            join(temp, String(index++)),
          ),
      );
      group.texts.forEach((text, position) =>
        audio.set(`${key}|${text}`, pcm[position]!),
      );
    }
    const voicesUsed = Object.fromEntries(
      [...models].map(([language, model]) => [
        language,
        basename(model, ".onnx"),
      ]),
    );
    const name = basename(out);
    await mkdir(join(out, "cards"));
    const parts = [silence(0.5)];
    let offset = 0.5;
    const contents = await timed("Сборка дорожек", async () => {
      const result = [];
      for (const [position, card] of cards.entries()) {
        const pcm = Buffer.concat(
          card.steps.flatMap((step) => [
            audio.get(
              `${models.get(step.language)}|${lengthScale(step.learning, options.slow)}|${step.text}`,
            )!,
            silence(step.pause),
          ]),
        );
        const file = `cards/${String(position + 1).padStart(3, "0")}-${slug(card.word.term)}.m4a`;
        await encode(
          ffmpeg,
          pcm,
          rate,
          temp,
          join(out, file),
          `${card.word.term} - ${card.word.translation}`,
        );
        result.push({
          term: card.word.term,
          translation: card.word.translation,
          file,
          startSeconds: Math.round(offset * 10) / 10,
        });
        parts.push(pcm);
        offset += pcm.length / 2 / rate;
      }
      await encode(
        ffmpeg,
        Buffer.concat(parts),
        rate,
        temp,
        join(out, `${name}.m4a`),
        name,
      );
      return result;
    });
    await writeFile(
      join(out, "listen.json"),
      JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          source: input,
          options: {
            due: !!options.due,
            slow: !!options.slow,
            reverse: !!options.reverse,
          },
          voices: voicesUsed,
          words: cards.length,
          durationSeconds: Math.round(offset * 10) / 10,
          cards: contents,
        },
        null,
        2,
      ) + "\n",
      { flag: "wx" },
    );
    console.log(
      `Готово: ${plural(cards.length, "карточка", "карточки", "карточек")}, ${formatDuration(offset * 1000)}. Общая дорожка: ${join(out, `${name}.m4a`)}`,
    );
    return out;
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
