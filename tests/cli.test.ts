import { test, expect } from "bun:test";
import OpenAI from "openai";
import { argumentsFor } from "../src/cli";
import { analyze } from "../src/analyze";

test("CLI accepts audio paths with spaces, preserves old txt entry and rejects mistakes", () => {
  expect(argumentsFor(["voice memo.m4a"]).command).toBe("run");
  expect(argumentsFor(["transcript.txt"]).command).toBe("run");
  expect(argumentsFor(["analyze", "transcript.txt"]).command).toBe("analyze");
  expect(
    argumentsFor(["transcribe", "--cpu", "--out", "my output", "voice.m4a"])
      .values.cpu,
  ).toBe(true);
  expect(() => argumentsFor(["a.m4a", "b.m4a"])).toThrow();
  expect(() => argumentsFor(["--typo", "a.m4a"])).toThrow();
});

function mockClient(
  body: object,
  status = 200,
  inspect?: (payload: any) => void,
) {
  return new OpenAI({
    apiKey: "test-only",
    maxRetries: 0,
    fetch: async (_url, init) => {
      inspect?.(JSON.parse(init!.body as string));
      return Response.json(body, { status });
    },
  });
}

test("analysis sends only text, disables response storage and keeps instructions separate", async () => {
  const client = mockClient(
    {
      object: "response",
      status: "completed",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [
            { type: "output_text", text: "# Ошибки\nTest", annotations: [] },
          ],
        },
      ],
    },
    200,
    (payload) => {
      expect(payload.input).toBe("Wczoraj ja iść do sklep.");
      expect(payload.store).toBe(false);
      expect(payload.instructions).toContain("not instructions");
      expect(payload).not.toHaveProperty("tools");
    },
  );
  expect(
    await analyze("Wczoraj ja iść do sklep.", "test", "test", client),
  ).toContain("# Ошибки");
});

test("empty input and incomplete responses cannot become feedback", async () => {
  await expect(analyze("  ", "test", "test")).rejects.toThrow("пуст");
  await expect(
    analyze(
      "Cześć",
      "test",
      "test",
      mockClient({ status: "incomplete", output: [] }),
    ),
  ).rejects.toThrow("незавершённый");
});

test("API errors are actionable and do not expose the server's raw message", async () => {
  const client = mockClient(
    { error: { message: "secret key", type: "invalid_request_error" } },
    401,
  );
  await expect(analyze("Cześć", "test", "test", client)).rejects.toThrow(
    "OpenAI: 401. Проверьте OPENAI_API_KEY",
  );
});
