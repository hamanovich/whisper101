import { test, expect } from "bun:test";
import OpenAI from "openai";
import { textTask } from "../src/tasks/text";
import { coach, coachMarkdown } from "../src/tasks/coach";
import { recognitionScores } from "../src/recognition";

test("meeting and note preserve language settings and send only transcript data", async () => {
  const seen: string[] = [];
  const client = new OpenAI({
    apiKey: "test",
    maxRetries: 0,
    fetch: async (_url, init) => {
      const body = JSON.parse(init!.body as string);
      seen.push(body.instructions);
      expect(body.store).toBe(false);
      expect(body.input).toBe("We discussed the release.");
      expect(body.instructions).toContain("language code pl");
      return Response.json({
        object: "response",
        status: "completed",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "# Wynik" }],
          },
        ],
      });
    },
  });
  for (const task of ["meeting", "note"] as const)
    expect(
      await textTask(
        "We discussed the release.",
        { task, language: "en", feedbackLanguage: "pl" },
        "test",
        "test",
        client,
      ),
    ).toContain("Wynik");
  expect(seen[0]).toContain("owners and deadlines ONLY when explicitly stated");
  expect(seen[1]).toContain("do not add facts");
});

test("coach supports English source and English or Polish report labels", async () => {
  const data = {
    corrected_transcript: "Hello",
    natural_phrases: [],
    grammar_issues: [],
    native_formulations: [],
    vocabulary: [],
    uncertain_passages: [],
  };
  const client = new OpenAI({
    apiKey: "test",
    maxRetries: 0,
    fetch: async (_url, init) => {
      const body = JSON.parse(init!.body as string);
      expect(body.instructions).toContain("Source language: en");
      expect(body.instructions).toContain("Feedback language code: en");
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
  const result = await coach("Hello", "test", "test", client, {
    language: "en",
    feedbackLanguage: "en",
  });
  const recognition = {
    ...recognitionScores(null),
    language: "en",
    durationSeconds: null,
  };
  expect(coachMarkdown(result, recognition, "Hello", "en")).toContain(
    "## Corrected version",
  );
  expect(coachMarkdown(result, recognition, "Hello", "en")).not.toContain(
    "Польская речь",
  );
  expect(coachMarkdown(result, recognition, "Hello", "pl")).toContain(
    "## Poprawiona wersja",
  );
});
