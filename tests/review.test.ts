import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readSavedRun } from "../src/history";
import { reviewTranscript } from "../src/review";
import { pipeline } from "../src/pipeline";
import { directSelection } from "../src/options";
import type { WizardUI } from "../src/wizard";

function prompts(confirm: boolean): WizardUI {
  return {
    pick: async () => "",
    confirm: async () => confirm,
    show: () => {},
  };
}

test("review creates a reusable copy without changing the Whisper transcript", async () => {
  const root = await mkdtemp(join(tmpdir(), "review-"));
  try {
    await writeFile(join(root, "transcript.txt"), "Whisper text");
    const run = await readSavedRun(root);
    let opened = "";
    const reviewed = await reviewTranscript(
      run!,
      prompts(true),
      async (path) => {
        opened = path;
      },
    );

    expect(opened).toBe(join(root, "transcript.reviewed.txt"));
    expect(reviewed).toEqual({
      input: opened,
      sourceRun: root,
      transcriptSource: "reviewed",
    });
    expect(await Bun.file(opened).text()).toBe("Whisper text");
    await writeFile(opened, "Corrected text");

    const second = await reviewTranscript(run!, prompts(false), async () => {});
    expect(second).toBeNull();
    expect(await Bun.file(opened).text()).toBe("Corrected text");
    expect(await Bun.file(join(root, "transcript.txt")).text()).toBe(
      "Whisper text",
    );
    await writeFile(opened, "");
    expect(
      reviewTranscript(run!, prompts(true), async () => {}),
    ).rejects.toThrow("Файл не найден или пуст");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("analysis continuation preserves original and marks reviewed input", async () => {
  const root = await mkdtemp(join(tmpdir(), "review-pipeline-"));
  try {
    const source = join(root, "source");
    await mkdir(source);
    await writeFile(join(source, "transcript.txt"), "Whisper original");
    await writeFile(
      join(source, "transcript.reviewed.txt"),
      "Corrected transcript",
    );
    const out = await pipeline({
      ...directSelection("transcribe"),
      input: join(source, "transcript.reviewed.txt"),
      sourceRun: source,
      transcriptSource: "reviewed",
      out: join(root, "result"),
      textInput: true,
      cpu: false,
      keepWav: true,
    });

    expect(await Bun.file(join(out, "transcript.txt")).text()).toBe(
      "Whisper original",
    );
    expect(await Bun.file(join(out, "transcript.reviewed.txt")).text()).toBe(
      "Corrected transcript",
    );
    const metadata = await Bun.file(join(out, "run.json")).json();
    expect(metadata.transcriptSource).toBe("reviewed");
    const html = await Bun.file(join(out, "report.html")).text();
    expect(html).toContain("Corrected transcript");
    expect(html).not.toContain("Whisper original");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
