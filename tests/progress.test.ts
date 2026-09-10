import { test, expect } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  changedWords,
  collectProgress,
  normalize,
  plural,
  renderProgress,
  writeProgress,
} from "../src/progress";

function silence(seconds: number) {
  const bytes = 32000 * seconds;
  const wav = Buffer.alloc(44 + bytes);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(bytes, 40);
  return wav;
}

async function run(
  root: string,
  name: string,
  startedAt: string,
  coach?: unknown,
) {
  const directory = join(root, name);
  await mkdir(directory);
  await writeFile(join(directory, "transcript.txt"), "Tekst nagrania");
  await writeFile(
    join(directory, "run.json"),
    JSON.stringify({
      task: "coach",
      status: "completed",
      requestedLanguage: "pl",
      feedbackLanguage: "ru",
      startedAt,
    }),
  );
  if (coach !== undefined)
    await writeFile(
      join(directory, "coach.json"),
      typeof coach === "string" ? coach : JSON.stringify(coach),
    );
  return directory;
}

test("word level comparison finds the changed words and ignores order and punctuation", () => {
  expect(changedWords("W domie mieszkam", "W domu mieszkam")).toEqual({
    removed: ["domie"],
    added: ["domu"],
  });
  expect(changedWords("Jestem w domie.", "Jestem w domu!")).toEqual({
    removed: ["domie"],
    added: ["domu"],
  });
  expect(changedWords("Ala ma kota", "Ala ma kota")).toEqual({
    removed: [],
    added: [],
  });
  expect(normalize("  Ala,   MA  kota! ")).toBe("ala ma kota");
});

test("progress counts repeated words across sentences and merges vocabulary keeping the newest form", async () => {
  const root = await mkdtemp(join(tmpdir(), "progress-"));
  try {
    const first = await run(root, "first", "2026-08-03T12:00:00.000Z", {
      recognition: { meanTokenProbability: 0.8 },
      corrected_transcript: "W domu mieszkam",
      natural_phrases: [{ phrase: "dzień dobry", reason: "naturalne" }],
      grammar_issues: [
        {
          original: "W domie mieszkam",
          corrected: "W domu mieszkam",
          explanation: "Miejscownik",
        },
      ],
      native_formulations: [],
      vocabulary: [{ word: "dom", translation: "дом", example: "mój dom" }],
      uncertain_passages: [],
    });
    await writeFile(join(first, "audio.wav"), silence(60));
    await run(root, "second", "2026-08-17T12:00:00.000Z", {
      recognition: { meanTokenProbability: 0.6 },
      corrected_transcript: "Jestem w domu",
      natural_phrases: [],
      grammar_issues: [
        {
          original: "Jestem w domie",
          corrected: "Jestem w domu",
          explanation: "Znowu miejscownik",
        },
      ],
      native_formulations: [],
      vocabulary: [
        { word: "Dom", translation: "дом", example: "duży dom" },
        { word: "kot", translation: "кот", example: "mały kot" },
      ],
      uncertain_passages: [],
    });
    await run(root, "broken", "2026-08-10T12:00:00.000Z", "{not json");

    const progress = await collectProgress(root);
    expect(progress.runs).toBe(3);
    expect(progress.coached).toBe(2);
    expect(Math.round(progress.seconds)).toBe(60);
    expect(progress.phrases).toBe(1);
    expect(progress.languages).toEqual(["pl"]);
    expect(progress.corrections).toEqual([]);
    expect(progress.words).toEqual([
      expect.objectContaining({ from: "domie", to: "domu", count: 2 }),
    ]);
    expect(progress.vocabulary).toEqual([
      expect.objectContaining({ word: "Dom", example: "duży dom", count: 2 }),
      expect.objectContaining({ word: "kot", count: 1 }),
    ]);
    expect(progress.weeks.map((week) => week.runs)).toEqual([1, 1, 1]);
    expect(progress.weeks[0]!.label).toBe("03.08");
    expect(progress.confidence).toBeCloseTo(0.7);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("summary page escapes saved text and can be rebuilt over an existing file", async () => {
  const root = await mkdtemp(join(tmpdir(), "progress-html-"));
  try {
    await expect(collectProgress(join(root, "missing"))).resolves.toEqual(
      expect.objectContaining({ runs: 0 }),
    );
    await expect(writeProgress(root)).rejects.toThrow("История пуста");
    await run(root, "first", "2026-08-03T12:00:00.000Z", {
      recognition: {},
      corrected_transcript: "",
      natural_phrases: [],
      grammar_issues: [],
      native_formulations: [],
      vocabulary: [
        {
          word: "<script>alert(1)</script>",
          translation: "дом",
          example: "mój dom",
        },
      ],
      uncertain_passages: [],
    });
    const path = await writeProgress(root);
    expect(path).toBe(join(root, "progress.html"));
    const html = await Bun.file(path).text();
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("default-src 'none'");
    expect(await writeProgress(root)).toBe(path);
    expect(
      (await Array.fromAsync(new Bun.Glob("*.tmp").scan(root))).length,
    ).toBe(0);
    expect(renderProgress(await collectProgress(root))).toContain(
      "минут практики",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("russian counts use the right ending for one, few and many", () => {
  expect(plural(1, "запись", "записи", "записей")).toBe("1 запись");
  expect(plural(3, "запись", "записи", "записей")).toBe("3 записи");
  expect(plural(11, "запись", "записи", "записей")).toBe("11 записей");
  expect(plural(21, "запись", "записи", "записей")).toBe("21 запись");
  expect(plural(114, "запись", "записи", "записей")).toBe("114 записей");
  expect(plural(0, "минута", "минуты", "минут")).toBe("0 минут");
});
