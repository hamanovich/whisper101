import { test, expect } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { createOutputDirectory } from "../src/output";
import { argumentsFor } from "../src/cli";

test("concurrent runs get separate dated folders and preserve earlier results", async () => {
  const parent = await mkdtemp(join(tmpdir(), "whisper-output-"));
  try {
    const date = new Date(2026, 8, 9);
    const first = await createOutputDirectory(parent, "polish.m4a", date);
    await writeFile(join(first, "transcript.txt"), "original");
    const next = await Promise.all([
      createOutputDirectory(parent, "polish.m4a", date),
      createOutputDirectory(parent, "polish.m4a", date),
    ]);
    expect(basename(first)).toBe("polish-2026-09-09");
    expect(next.map((path) => basename(path)).sort()).toEqual([
      "polish-2026-09-09-2",
      "polish-2026-09-09-3",
    ]);
    expect(await Bun.file(join(first, "transcript.txt")).text()).toBe(
      "original",
    );
    expect(argumentsFor(["polish.m4a"]).values["keep-wav"]).toBe(true);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
