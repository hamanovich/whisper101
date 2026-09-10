import { test, expect } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { listHistory, readSavedRun } from "../src/history";
import { continuation } from "../src/library";
import { pipeline } from "../src/pipeline";
import { directSelection } from "../src/options";
import { argumentsFor } from "../src/cli";

test("history handles missing roots, old folders and broken metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "history-"));
  try {
    expect(await listHistory(join(root, "missing"))).toEqual([]);
    for (const name of ["old", "recent", "broken", "empty"])
      await mkdir(join(root, name));
    await writeFile(join(root, "old", "transcript.txt"), "Old text");
    await writeFile(join(root, "recent", "transcript.txt"), "Recent text");
    await writeFile(
      join(root, "recent", "run.json"),
      JSON.stringify({
        task: "meeting",
        status: "failed",
        startedAt: "2099-01-01",
        requestedLanguage: "en",
        feedbackLanguage: "pl",
        openaiModel: "test-model",
      }),
    );
    await writeFile(join(root, "broken", "run.json"), "{");
    await writeFile(join(root, "broken", "feedback.md"), "# Saved feedback");
    const items = await listHistory(root);
    expect(items.length).toBe(3);
    expect(items[0]!.title).toBe("recent");
    const repeat = continuation(items[0]!, true);
    expect(repeat.selection).toEqual({
      task: "meeting",
      language: "en",
      feedbackLanguage: "pl",
    });
    expect(repeat.model).toBe("test-model");
    expect(repeat.input).toEndWith("transcript.txt");
    expect(continuation(items[0]!, false).selection).toBeUndefined();
    expect(() =>
      continuation(
        items.find((item) => item.title === "broken")!,
        true,
      ),
    ).toThrow("Нет транскрипта");
    expect(argumentsFor([]).command).toBe("run");
    expect(argumentsFor(["history"]).command).toBe("history");
    expect(argumentsFor(["report", root]).command).toBe("report");
    expect(argumentsFor(["--help"]).command).toBe("help");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("continuing a saved transcript preserves original files and carries audio without Whisper", async () => {
  const root = await mkdtemp(join(tmpdir(), "history-repeat-"));
  try {
    const source = join(root, "original");
    await mkdir(source);
    await writeFile(join(source, "transcript.txt"), "Original text.");
    await writeFile(join(source, "audio.wav"), "test audio placeholder");
    await writeFile(join(source, "feedback.md"), "Original feedback");
    const run = await readSavedRun(source);
    const options = continuation(run!, false);
    const out = await pipeline({
      ...directSelection("transcribe"),
      ...options,
      out: join(root, "next"),
      textInput: true,
      cpu: false,
      keepWav: true,
    });
    expect(await Bun.file(join(out, "audio.wav")).text()).toBe(
      "test audio placeholder",
    );
    expect(await Bun.file(join(source, "feedback.md")).text()).toBe(
      "Original feedback",
    );
    const metadata = await Bun.file(join(out, "run.json")).json();
    expect(metadata.sourceRun).toBe(source);
    expect(metadata.whisperModel).toBeNull();
    expect(metadata.status).toBe("completed");
    expect(await Bun.file(join(out, "report.html")).exists()).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
