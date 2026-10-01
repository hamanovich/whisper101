import { test, expect } from "bun:test";
import { chmod, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cardSteps,
  dueWords,
  languageCode,
  listen,
  parseCsv,
  readVocabulary,
  shuffled,
  type Word,
} from "../src/listen";
import { wavHeader } from "../src/record";
import { argumentsFor } from "../src/cli";

const header =
  "term,translation,example,exampleTranslation,learningLanguage,translationLanguage,srsBox,dueAt,learnedAt,createdAt";

const word = (overrides: Partial<Word> = {}): Word => ({
  term: "unikać",
  translation: "избегать",
  example: "Staram się unikać konfliktów.",
  exampleTranslation: "Я стараюсь избегать конфликтов.",
  learningLanguage: "polish",
  translationLanguage: "russian",
  srsBox: 0,
  dueAt: "",
  learnedAt: "",
  ...overrides,
});

test("CSV parser handles quotes, escaped quotes, commas, CRLF and a BOM", () => {
  expect(
    parseCsv('﻿a,b,c\r\n"x, y","say ""hi""",\r\nlast,"multi\nline",z'),
  ).toEqual([
    ["a", "b", "c"],
    ["x, y", 'say "hi"', ""],
    ["last", "multi\nline", "z"],
  ]);
  expect(parseCsv("a,b\n\n1,2\n")).toEqual([
    ["a", "b"],
    ["1", "2"],
  ]);
  expect(() => parseCsv('a,"broken\n')).toThrow("незакрытая кавычка");
});

test("vocabulary is read by column name and rows without a translation are skipped", () => {
  const words = readVocabulary(
    [
      "translation,learningLanguage,term,translationLanguage",
      '"капризничать, ныть",polish,Marudzić  się,russian',
      ",polish,pusty,russian",
    ].join("\n"),
  );
  expect(words).toHaveLength(1);
  expect(words[0]).toMatchObject({
    term: "Marudzić się",
    translation: "капризничать, ныть",
    example: "",
    srsBox: 0,
  });
  expect(() => readVocabulary("term,translation\nkot,кот")).toThrow(
    "learningLanguage, translationLanguage",
  );
  expect(() => readVocabulary("")).toThrow("CSV пуст");
});

test("due filter keeps new and overdue words and drops learned or future ones", () => {
  const now = new Date("2026-10-02T12:00:00Z");
  const words = [
    word({ term: "new" }),
    word({ term: "overdue", dueAt: "2026-10-02T05:00:00.000Z" }),
    word({ term: "future", dueAt: "2026-10-04T05:00:00.000Z" }),
    word({ term: "learned", learnedAt: "2026-09-01T00:00:00.000Z" }),
    word({ term: "broken date", dueAt: "soon" }),
  ];
  expect(dueWords(words, now).map((item) => item.term)).toEqual([
    "new",
    "overdue",
    "broken date",
  ]);
});

test("shuffle keeps every word once and leaves the original order untouched", () => {
  const items = ["a", "b", "c", "d", "e"];
  const result = shuffled(items, () => 0);
  expect(result).toEqual(["b", "c", "d", "e", "a"]);
  expect(items).toEqual(["a", "b", "c", "d", "e"]);
  for (let attempt = 0; attempt < 20; attempt++)
    expect(shuffled(items).sort()).toEqual(items);
  expect(shuffled([])).toEqual([]);
});

test("language names from the export map to voice codes", () => {
  expect(languageCode("polish")).toBe("pl");
  expect(languageCode(" Russian ")).toBe("ru");
  expect(languageCode("pl")).toBe("pl");
  expect(languageCode("klingon")).toBeNull();
});

test("a card asks first, answers, then plays the example and its translation", () => {
  const steps = cardSteps(word());
  expect(steps.map((step) => [step.language, step.text])).toEqual([
    ["pl", "unikać"],
    ["ru", "избегать"],
    ["pl", "Staram się unikać konfliktów."],
    ["ru", "Я стараюсь избегать конфликтов."],
  ]);
  expect(steps[0]!.pause).toBeGreaterThan(steps[1]!.pause);
  expect(steps.at(-1)!.pause).toBe(steps[0]!.pause);
  expect(
    cardSteps(word(), { reverse: true })
      .slice(0, 2)
      .map((step) => step.language),
  ).toEqual(["ru", "pl"]);
  expect(cardSteps(word({ example: "", exampleTranslation: "" }))).toHaveLength(
    2,
  );
  expect(cardSteps(word(), { slow: true })[0]!.pause).toBeGreaterThan(
    steps[0]!.pause,
  );
  expect(() => cardSteps(word({ learningLanguage: "klingon" }))).toThrow(
    "klingon",
  );
});

test("listen flags belong to the listen command, which needs one CSV file", () => {
  const parsed = argumentsFor(["listen", "words.csv", "--due", "--slow"]);
  expect(parsed.command).toBe("listen");
  expect(parsed.file).toBe("words.csv");
  expect(parsed.values.due).toBe(true);
  expect(() => argumentsFor(["listen"])).toThrow();
  expect(() => argumentsFor(["voice.m4a", "--due"])).toThrow("listen");
  expect(() => argumentsFor(["record", "--reverse"])).toThrow("listen");
  expect(
    argumentsFor(["listen", "words.csv", "--shuffle"]).values.shuffle,
  ).toBe(true);
  expect(() => argumentsFor(["voice.m4a", "--shuffle"])).toThrow("--shuffle");
});

test.skipIf(!Bun.which("ffmpeg"))(
  "listen builds per-card tracks, a full track and metadata without overwriting",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "whisper101-listen-test-"));
    const saved = {
      bin: process.env.PIPER_BIN,
      voices: process.env.PIPER_VOICES,
    };
    try {
      const sample = join(root, "sample.wav");
      const pcm = Buffer.alloc(22050 / 5);
      await writeFile(
        sample,
        Buffer.concat([wavHeader(pcm.length, 22050), pcm]),
      );
      const piper = join(root, "piper");
      await writeFile(
        piper,
        [
          "#!/bin/sh",
          'dir=""',
          'while [ $# -gt 0 ]; do case "$1" in -d) dir="$2"; shift 2;; *) shift;; esac; done',
          "i=1000",
          `while IFS= read -r line; do [ -n "$line" ] && { i=$((i+1)); cp "${sample}" "$dir/$i.wav"; }; done`,
        ].join("\n") + "\n",
      );
      await chmod(piper, 0o755);
      for (const voice of ["pl_PL-mc_speech-medium", "ru_RU-ruslan-medium"]) {
        await writeFile(join(root, `${voice}.onnx`), "model");
        await writeFile(
          join(root, `${voice}.onnx.json`),
          JSON.stringify({ audio: { sample_rate: 22050 } }),
        );
      }
      process.env.PIPER_BIN = piper;
      process.env.PIPER_VOICES = root;
      const csv = join(root, "words.csv");
      await writeFile(
        csv,
        [
          header,
          'unikać,избегать,"Staram się, naprawdę.",Стараюсь.,polish,russian,2,2026-10-02T05:25:07.656Z,,2026-09-27T06:27:11.396Z',
          "tłum,толпа,,,polish,russian,0,,,2026-09-23T15:50:23.213Z",
        ].join("\n"),
      );
      const out = join(root, "result");
      expect(await listen(csv, { out })).toBe(out);
      expect((await readdir(join(out, "cards"))).sort()).toEqual([
        "001-unikać.m4a",
        "002-tłum.m4a",
      ]);
      expect(await Bun.file(join(out, "result.m4a")).exists()).toBe(true);
      const metadata = await Bun.file(join(out, "listen.json")).json();
      expect(metadata.words).toBe(2);
      expect(metadata.voices).toEqual({
        pl: "pl_PL-mc_speech-medium",
        ru: "ru_RU-ruslan-medium",
      });
      expect(metadata.cards[1].startSeconds).toBeGreaterThan(
        metadata.cards[0].startSeconds,
      );
      await expect(listen(csv, { out })).rejects.toThrow("несуществующую");
    } finally {
      for (const [key, value] of [
        ["PIPER_BIN", saved.bin],
        ["PIPER_VOICES", saved.voices],
      ] as const)
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      await rm(root, { recursive: true, force: true });
    }
  },
);
