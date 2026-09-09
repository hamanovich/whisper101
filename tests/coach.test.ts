import { test, expect } from "bun:test";
import OpenAI from "openai";
import {
  coach,
  parseCoaching,
  coachSummary,
  coachMarkdown,
  type Coaching,
} from "../src/coach";
import {
  recognitionScores,
  recordingLabel,
  wavDuration,
} from "../src/recognition";
import { argumentsFor } from "../src/cli";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const data: Coaching = {
  corrected_transcript: "Cześć.",
  natural_phrases: [{ phrase: "Cześć", reason: "Приветствие" }],
  grammar_issues: [],
  native_formulations: [],
  vocabulary: [],
  uncertain_passages: [],
};

test("coach requests structured text-only analysis and derives actual counts", async () => {
  let calls = 0;
  const client = new OpenAI({
    apiKey: "test",
    maxRetries: 0,
    fetch: async (_url, init) => {
      calls++;
      const body = JSON.parse(init!.body as string);
      expect(body.store).toBe(false);
      expect(body.input).toBe("Cześć");
      expect(body.text.format.strict).toBe(true);
      return Response.json({
        object: "response",
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: JSON.stringify(data) }],
          },
        ],
      });
    },
  });
  const result = await coach("Cześć", "test", "test", client);
  const recognition = { ...recognitionScores(null), durationSeconds: 163 };
  expect(coachSummary(result, recognition)).toContain("2:43");
  expect(coachSummary(result, recognition)).toContain("Естественные фразы: 1");
  expect(coachSummary(result, recognition)).toContain("транскрипту: 0");
  expect(coachMarkdown(result, recognition, "Cześć")).toContain(
    "## Транскрипт\n\nCześć",
  );
  await expect(coach(" ", "test", "test", client)).rejects.toThrow();
  expect(calls).toBe(1);
});

test("invalid structure and API refusal cannot produce a coach report", async () => {
  expect(() => parseCoaching('{"natural_phrases":7}')).toThrow();
  expect(() =>
    parseCoaching(
      JSON.stringify({
        ...data,
        vocabulary: Array(6).fill({
          word: "a",
          translation: "a",
          example: "a",
        }),
      }),
    ),
  ).toThrow();
  const client = new OpenAI({
    apiKey: "test",
    maxRetries: 0,
    fetch: async () =>
      Response.json({
        object: "response",
        status: "completed",
        output: [
          { type: "message", content: [{ type: "refusal", refusal: "no" }] },
        ],
      }),
  });
  await expect(coach("Cześć", "test", "test", client)).rejects.toThrow("пуст");
  expect(argumentsFor(["coach", "a.m4a"]).command).toBe("coach");
  expect(
    argumentsFor(["coach", "a.m4a", "--language", "en"]).values.language,
  ).toBe("en");
});

test("Whisper diagnostics exclude special tokens and do not fabricate missing probabilities", () => {
  const scores = recognitionScores({
    result: { language: "pl" },
    transcription: [
      {
        tokens: [
          { text: "Cześć", p: 0.8 },
          { text: " kolegu", p: 0.4 },
          { text: "[_BEG_]", p: 1 },
          { text: " ", p: 1 },
          { text: "x", p: -1 },
        ],
      },
    ],
  });
  expect(scores.scoredTokens).toBe(2);
  expect(scores.meanTokenProbability).toBeCloseTo(0.6);
  expect(scores.lowProbabilityTokens).toBe(1);
  expect(recognitionScores({}).meanTokenProbability).toBeNull();
  expect(recordingLabel(null)).toContain("недоступна");
});

test("duration uses WAV audio data length, including silence, rather than transcript timestamps", async () => {
  const directory = await mkdtemp(join(tmpdir(), "coach-wav-"));
  try {
    const wav = Buffer.alloc(44 + 32000);
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
    wav.writeUInt32LE(32000, 40);
    const path = join(directory, "audio.wav");
    await Bun.write(path, wav);
    expect(await wavDuration(path)).toBe(1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
