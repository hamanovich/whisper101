import { test, expect } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import OpenAI from "openai";
import { plainDashes } from "../src/text";
import { coach } from "../src/tasks/coach";
import { textTask } from "../src/tasks/text";
import { ensureReport, safeMarkdown } from "../src/report";
import { collectProgress } from "../src/progress";

const long = "—";
const en = "–";

function mockClient(text: string) {
  return new OpenAI({
    apiKey: "test-only",
    maxRetries: 0,
    fetch: async () =>
      Response.json({
        object: "response",
        status: "completed",
        output: [{ type: "message", content: [{ type: "output_text", text }] }],
      }),
  });
}

test("long dashes become hyphens while spacing and plain hyphens survive", () => {
  expect(plainDashes(`слово ${long} это`)).toBe("слово - это");
  expect(plainDashes(`слово ${en} это`)).toBe("слово - это");
  expect(plainDashes(`${long} пункт списка`)).toBe("- пункт списка");
  expect(plainDashes("2010―2020")).toBe("2010-2020");
  expect(plainDashes("уже-дефис и −минус")).toBe("уже-дефис и -минус");
  expect(plainDashes("без тире")).toBe("без тире");
});

test("coach replaces long dashes in every explanation before saving", async () => {
  const data = {
    corrected_transcript: `Mam ${long} psa`,
    natural_phrases: [{ phrase: "dzień dobry", reason: `фраза ${long} верна` }],
    grammar_issues: [
      {
        original: "słownik",
        corrected: "słownictwo",
        explanation: `„słownik" ${long} это книга`,
      },
    ],
    native_formulations: [],
    vocabulary: [
      { word: "dom", translation: `дом ${en} здание`, example: "mój dom" },
    ],
    uncertain_passages: [`неясно ${long} сверьте`],
  };
  const result = await coach(
    "Tekst",
    "test",
    "gpt-5.6-terra",
    mockClient(JSON.stringify(data)),
  );
  expect(JSON.stringify(result)).not.toContain(long);
  expect(JSON.stringify(result)).not.toContain(en);
  expect(result.grammar_issues[0]!.explanation).toBe('„słownik" - это книга');
  expect(result.vocabulary[0]!.translation).toBe("дом - здание");
});

test("meeting and note results and rendered markdown carry no long dashes", async () => {
  const feedback = await textTask(
    "Tekst",
    { task: "meeting", language: "pl", feedbackLanguage: "ru" },
    "test",
    "gpt-5.6-terra",
    mockClient(`# Итоги\n\nРешение ${long} принято.`),
  );
  expect(feedback).not.toContain(long);
  expect(feedback).toContain("Решение - принято.");
  expect(safeMarkdown(`Старый отчёт ${long} с тире`)).not.toContain(long);
});

test("reports and progress clean long dashes saved by earlier runs", async () => {
  const root = await mkdtemp(join(tmpdir(), "dashes-"));
  try {
    const directory = join(root, "run");
    await Bun.write(join(directory, "transcript.txt"), "Tekst nagrania");
    await writeFile(
      join(directory, "run.json"),
      JSON.stringify({
        task: "coach",
        status: "completed",
        requestedLanguage: "pl",
        feedbackLanguage: "ru",
        startedAt: "2026-08-03T12:00:00.000Z",
      }),
    );
    await writeFile(
      join(directory, "coach.json"),
      JSON.stringify({
        recognition: {},
        corrected_transcript: "Mam psa",
        natural_phrases: [],
        grammar_issues: [
          {
            original: "słownik polskiego",
            corrected: "słownictwo po polsku",
            explanation: `„słownik" ${long} это книга`,
          },
        ],
        native_formulations: [],
        vocabulary: [
          {
            word: "dom",
            translation: `дом ${long} здание`,
            example: "mój dom",
          },
        ],
        uncertain_passages: [],
      }),
    );

    const html = await Bun.file(await ensureReport(directory)).text();
    expect(html).not.toContain(long);
    expect(html).toContain("это книга");

    const progress = await collectProgress(root);
    expect(progress.words[0]?.explanation ?? "").not.toContain(long);
    expect(progress.vocabulary[0]!.translation).toBe("дом - здание");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
