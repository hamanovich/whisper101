import { test, expect } from "bun:test";
import {
  collectSelection,
  Cancelled,
  loadPreferences,
  preferredModel,
  savePreferences,
  type WizardUI,
} from "../src/wizard";
import { settings } from "../src/library";
import { defaultModel, directSelection, models } from "../src/options";
import { argumentsFor, main } from "../src/cli";
import { pipeline } from "../src/pipeline";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function fake(answers: string[], confirmed = true) {
  const questions: string[] = [];
  const initialValues: string[] = [];
  const ui: WizardUI = {
    async pick(message, _choices, initial) {
      questions.push(message);
      initialValues.push(initial);
      return answers.shift()!;
    },
    async confirm() {
      return confirmed;
    },
    show() {},
  };
  return { ui, questions, initialValues };
}

test("wizard skips irrelevant questions and explicit flags win over saved defaults", async () => {
  const transcription = fake(["transcribe", "auto"]);
  const result = await collectSelection(
    "a.m4a",
    false,
    {},
    { task: "note", language: "pl", feedbackLanguage: "en" },
    transcription.ui,
  );
  expect(result.task).toBe("transcribe");
  expect(transcription.questions.length).toBe(2);
  expect(transcription.initialValues).toEqual(["note", "pl"]);
  const text = fake(["meeting", "en"]);
  expect(
    (await collectSelection("a.txt", true, {}, {}, text.ui)).language,
  ).toBe("auto");
  expect(text.questions.length).toBe(2);
  const preset = fake(["coach"]);
  expect(
    await collectSelection(
      "a.m4a",
      false,
      { language: "en", feedbackLanguage: "pl" },
      { language: "ru" },
      preset.ui,
    ),
  ).toEqual({ task: "coach", language: "en", feedbackLanguage: "pl" });
  expect(preset.questions.length).toBe(1);
});

test("declining confirmation and cancellation stop the wizard", async () => {
  await expect(
    collectSelection(
      "a.m4a",
      false,
      { task: "transcribe", language: "pl" },
      {},
      fake([], false).ui,
    ),
  ).rejects.toBeInstanceOf(Cancelled);
  const prompts = fake([]).ui;
  prompts.pick = async () => {
    throw new Cancelled();
  };
  await expect(
    collectSelection("a.m4a", false, {}, {}, prompts),
  ).rejects.toBeInstanceOf(Cancelled);
});

test("settings round-trip stores only choices and ignores corrupt values", async () => {
  const root = await mkdtemp(join(tmpdir(), "whisper-prefs-"));
  const path = join(root, "settings.json");
  try {
    const selection = directSelection("meeting", "ru", "en");
    await savePreferences(
      {
        ...selection,
        input: "private.wav",
        apiKey: "secret",
      } as typeof selection,
      path,
    );
    expect(await loadPreferences(path)).toEqual(selection);
    expect(await readFile(path, "utf8")).not.toContain("secret");
    await Bun.write(
      path,
      '{"task":"unknown","language":"--bad","feedbackLanguage":"de"}',
    );
    expect(await loadPreferences(path)).toEqual({});
    await Bun.write(path, "broken");
    expect(await loadPreferences(path)).toEqual({});
    expect(directSelection("meeting")).toEqual({
      task: "meeting",
      language: "auto",
      feedbackLanguage: "ru",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("direct CLI validates tasks and cannot hang without a TTY", async () => {
  expect(
    argumentsFor(["a.m4a", "--task", "note", "--feedback-language", "en"])
      .values.task,
  ).toBe("note");
  expect(() => argumentsFor(["a.m4a", "--task", "bad"])).toThrow();
  expect(() => argumentsFor(["coach", "a.m4a", "--task", "meeting"])).toThrow();
  const root = await mkdtemp(join(tmpdir(), "whisper-cli-"));
  const input = join(root, "input.txt");
  try {
    await Bun.write(input, "Hello.");
    if (!process.stdin.isTTY)
      await expect(
        main([input, "--out", join(root, "cancelled")]),
      ).rejects.toThrow("терминал");
    expect(await Bun.file(join(root, "cancelled", "run.json")).exists()).toBe(
      false,
    );
    const out = await pipeline({
      ...directSelection("transcribe"),
      input,
      textInput: true,
      out: join(root, "result"),
      cpu: false,
      keepWav: true,
    });
    expect(await Bun.file(join(out, "transcript.txt")).text()).toBe("Hello.");
    const run = await Bun.file(join(out, "run.json")).json();
    expect(run.status).toBe("completed");
    expect(run.whisperModel).toBeNull();
    expect(run.openaiModel).toBeNull();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("model preference wins over the environment and never erases other settings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "settings-"));
  const path = join(directory, "settings.json");
  const previous = process.env.OPENAI_MODEL;
  try {
    process.env.OPENAI_MODEL = "gpt-5.6-sol";
    expect(await preferredModel(undefined, path)).toEqual({
      model: "gpt-5.6-sol",
      source: "env",
    });
    delete process.env.OPENAI_MODEL;
    expect(await preferredModel(undefined, path)).toEqual({
      model: defaultModel,
      source: "default",
    });
    expect(defaultModel).toBe("gpt-5.6-terra");
    expect(models).toContain("gpt-6-astra");

    await savePreferences(directSelection("coach", "pl", "ru"), path);
    await savePreferences({ model: "gpt-6-astra" }, path);
    expect(await loadPreferences(path)).toEqual({
      task: "coach",
      language: "pl",
      feedbackLanguage: "ru",
      model: "gpt-6-astra",
    });

    process.env.OPENAI_MODEL = "gpt-5.6-sol";
    expect(await preferredModel(undefined, path)).toEqual({
      model: "gpt-6-astra",
      source: "settings",
    });
    expect(await preferredModel("gpt-5.6-luna", path)).toEqual({
      model: "gpt-5.6-luna",
      source: "flag",
    });

    await savePreferences(directSelection("note", "auto", "en"), path);
    expect((await loadPreferences(path)).model).toBe("gpt-6-astra");
    await Bun.write(path, JSON.stringify({ model: "не модель" }));
    expect(await loadPreferences(path)).toEqual({});
  } finally {
    if (previous === undefined) delete process.env.OPENAI_MODEL;
    else process.env.OPENAI_MODEL = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test("settings screen saves a chosen model and leaves it alone on back", async () => {
  const directory = await mkdtemp(join(tmpdir(), "settings-ui-"));
  const path = join(directory, "settings.json");
  try {
    const chosen = fake(["gpt-6-astra"]);
    await settings(chosen.ui, path);
    expect(chosen.questions[0]).toContain("модель");
    expect(chosen.initialValues[0]).toBe(defaultModel);
    expect((await loadPreferences(path)).model).toBe("gpt-6-astra");

    const kept = fake(["back"]);
    await settings(kept.ui, path);
    expect(kept.initialValues[0]).toBe("gpt-6-astra");
    expect((await loadPreferences(path)).model).toBe("gpt-6-astra");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
