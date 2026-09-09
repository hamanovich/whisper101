import { access, rm, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { config } from "./config";
import { timed } from "./timing";

export async function executable(command: string) {
  const path = command.includes("/") ? command : Bun.which(command);
  if (!path) throw new Error(`Не найдена программа: ${command}`);
  try {
    await access(path, constants.X_OK);
  } catch {
    throw new Error(`Программа недоступна для запуска: ${path}`);
  }
  return path;
}

export async function inputFile(path: string) {
  const info = await stat(path).catch(() => null);
  if (!info?.isFile() || !info.size)
    throw new Error(`Файл не найден или пуст: ${path}`);
}

async function run(command: string[], label: string) {
  return timed(label, async () => {
    const child = Bun.spawn(command, {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "pipe",
    });
    const [code, stderr] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
    ]);
    if (code !== 0)
      throw new Error(`${label}: код ${code}.\n${stderr.slice(-2500)}`);
  });
}

export async function transcribe(
  input: string,
  out: string,
  language: string,
  keepWav: boolean,
  cpu: boolean,
  fullJson = false,
) {
  const c = config();
  const ffmpeg = await executable(c.ffmpeg);
  const whisper = await executable(c.whisper);
  await inputFile(c.whisperModel);
  const wav = join(out, "audio.wav");
  const prefix = join(out, "transcript");
  try {
    console.log("Конвертирую аудио локально…");
    await run(
      [
        ffmpeg,
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        input,
        "-map",
        "0:a:0",
        "-vn",
        "-ar",
        "16000",
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        wav,
      ],
      "Конвертация ffmpeg",
    );
    console.log(`Распознаю речь локально, язык: ${language.toUpperCase()}`);
    await run(
      [
        whisper,
        "-m",
        c.whisperModel,
        "-l",
        language,
        "-f",
        wav,
        "-otxt",
        "-of",
        prefix,
        ...(cpu ? ["-ng"] : []),
        ...(fullJson ? ["-ojf"] : []),
      ],
      "Распознавание whisper.cpp",
    );
    const transcript = Bun.file(prefix + ".txt");
    if (!(await transcript.exists()))
      throw new Error("whisper.cpp не создал transcript.txt.");
    const text = await transcript.text();
    if (!text.trim())
      throw new Error("Речь не распознана: transcript.txt пуст.");
    return text;
  } finally {
    if (!keepWav) await rm(wav, { force: true });
  }
}
