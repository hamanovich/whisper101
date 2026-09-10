import { test, expect } from "bun:test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderReport, safeMarkdown, ensureReport } from "../src/report";
import { argumentsFor } from "../src/cli";

test("coach uses structured comparisons, keeps full text collapsed and escapes every field", async () => {
  const root = await mkdtemp(join(tmpdir(), "coach-report-"));
  try {
    await writeFile(join(root, "transcript.txt"), "Unique original transcript");
    await writeFile(join(root, "feedback.md"), "Duplicate legacy transcript");
    await writeFile(
      join(root, "run.json"),
      JSON.stringify({
        task: "coach",
        requestedLanguage: "pl",
        feedbackLanguage: "en",
        status: "completed",
      }),
    );
    await writeFile(
      join(root, "coach.json"),
      JSON.stringify({
        recognition: { durationSeconds: 219 },
        corrected_transcript: "Full corrected text",
        natural_phrases: [
          { phrase: "<script>bad()</script>", reason: "Good phrase" },
        ],
        grammar_issues: Array.from({ length: 4 }, (_, i) => ({
          original: `Original ${i}`,
          corrected: `Correction ${i}`,
          explanation: "Explanation",
        })),
        native_formulations: [],
        vocabulary: [],
        uncertain_passages: ["Check this passage"],
      }),
    );
    const html = await Bun.file(await ensureReport(root)).text();
    expect(html).toContain('class="pair"');
    expect(html).toContain("Make it clearer");
    expect(html).toContain("Show all (1)");
    expect(html).toContain("Original 3");
    expect(html).toContain("Full corrected text");
    expect(html).toContain("&lt;script&gt;bad()");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("Duplicate legacy transcript");
    expect(html.split("Unique original transcript").length).toBe(2);
    expect(html).not.toContain("<details open");
    await writeFile(join(root, "coach.json"), "{}");
    const refreshed = await Bun.file(
      await ensureReport(root, { refresh: true }),
    ).text();
    expect(refreshed).toContain("Duplicate legacy transcript");
    const backups = (await readdir(root)).filter((name) =>
      name.startsWith("report.backup-"),
    );
    expect(backups).toHaveLength(1);
    expect(await Bun.file(join(root, backups[0]!)).text()).toBe(html);
    expect(argumentsFor(["report", root, "--refresh"]).values.refresh).toBe(
      true,
    );
    expect(() => argumentsFor(["audio.m4a", "--refresh"])).toThrow(
      "только для команды report",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("report escapes transcript and strips executable or remote embedded Markdown content", () => {
  const feedback =
    '# Result\n<script>alert(1)</script>\n<img src="https://tracker.invalid/a" onerror="alert(1)">\n[x](javascript:alert(1))\n\n| A | B |\n|---|---|\n| 1 | 2 |';
  const safe = safeMarkdown(feedback);
  expect(safe).not.toContain("<script");
  expect(safe).not.toContain("<img");
  expect(safe).not.toContain('href="javascript:');
  expect(
    safeMarkdown('<a href="javascript:alert(1)">unsafe</a>'),
  ).not.toContain("href=");
  expect(safe).toContain("<table>");
  const html = renderReport({
    title: '<img src=x onerror="alert(1)">',
    task: "coach",
    date: "today",
    status: "completed",
    transcript: "<script>evil()</script>",
    feedback,
    audio: true,
    reviewed: false,
  });
  expect(html).toContain("&lt;script&gt;evil()");
  expect(html).toContain('src="audio.wav"');
  expect(html).toContain("Content-Security-Policy");
  expect(html).not.toContain("<script");
});

test("reviewed runs show and download the checked transcript", async () => {
  const root = await mkdtemp(join(tmpdir(), "reviewed-report-"));
  try {
    await writeFile(join(root, "transcript.txt"), "Whisper original");
    await writeFile(
      join(root, "transcript.reviewed.txt"),
      "Human-reviewed text",
    );
    await writeFile(
      join(root, "run.json"),
      JSON.stringify({
        task: "coach",
        status: "completed",
        transcriptSource: "reviewed",
      }),
    );
    const html = await Bun.file(await ensureReport(root)).text();
    expect(html).toContain("Human-reviewed text");
    expect(html).not.toContain("Whisper original");
    expect(html).toContain("Проверенный текст");
    expect(html).toContain('href="transcript.reviewed.txt"');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("old and failed runs can get an offline report without overwriting existing results", async () => {
  const root = await mkdtemp(join(tmpdir(), "report-"));
  try {
    await writeFile(join(root, "transcript.txt"), "Saved transcript");
    await writeFile(
      join(root, "run.json"),
      JSON.stringify({ task: "coach", status: "failed" }),
    );
    const path = await ensureReport(root);
    const html = await Bun.file(path).text();
    expect(html).toContain("Анализ мог не завершиться");
    expect(html).toContain("Разбора пока нет");
    expect(html).toContain("В этой папке нет аудио");
    expect(html).not.toContain("<audio");
    await writeFile(path, "Existing report");
    expect(await ensureReport(root)).toBe(path);
    expect(await Bun.file(path).text()).toBe("Existing report");
    expect(await Bun.file(join(root, "transcript.txt")).text()).toBe(
      "Saved transcript",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
