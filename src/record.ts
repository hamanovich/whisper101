import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "./config";
import { executable } from "./transcribe";
import { recordingLabel, wavDuration } from "./recognition";
import { Cancelled } from "./wizard";

export type AudioDevice = { id: string; name: string };
export type Recording = {
  path: string;
  seconds: number;
  discard: () => Promise<void>;
};

export const maxSeconds = 10_800;

export function audioInput(platform: string = process.platform) {
  const format =
    process.env.AUDIO_FORMAT ||
    (platform === "darwin"
      ? "avfoundation"
      : platform === "linux"
        ? "pulse"
        : "");
  const device =
    process.env.AUDIO_DEVICE ||
    (format === "avfoundation" ? ":default" : "default");
  return { format, device };
}

export function recordCommand(
  ffmpeg: string,
  format: string,
  device: string,
  output: string,
  seconds = maxSeconds,
) {
  return [
    ffmpeg,
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    format,
    "-i",
    device,
    "-map",
    "0:a:0",
    "-ar",
    "16000",
    "-ac",
    "1",
    "-c:a",
    "pcm_s16le",
    "-t",
    String(Math.max(1, Math.round(seconds))),
    "-y",
    output,
  ];
}

export function parseAudioDevices(text: string): AudioDevice[] {
  const devices: AudioDevice[] = [];
  let audio = false;
  for (const line of text.split("\n")) {
    if (/audio devices:/i.test(line)) audio = true;
    else if (/video devices:/i.test(line)) audio = false;
    else if (audio) {
      const match = line.match(/\[(\d+)\]\s+(\S.*?)\s*$/);
      if (match) devices.push({ id: `:${match[1]}`, name: match[2]! });
    }
  }
  return devices;
}

export async function audioDevices(): Promise<AudioDevice[]> {
  if (audioInput().format !== "avfoundation") return [];
  const ffmpeg = await executable(config().ffmpeg);
  const child = Bun.spawn(
    [
      ffmpeg,
      "-hide_banner",
      "-f",
      "avfoundation",
      "-list_devices",
      "true",
      "-i",
      "",
    ],
    { stdin: "ignore", stdout: "ignore", stderr: "pipe" },
  );
  const [, text] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]);
  return parseAudioDevices(text);
}

export function pressed(key: string) {
  if (key.includes("\x03") || key.includes("\x04")) return "cancel";
  if (key.includes("\r") || key.includes("\n")) return "stop";
  if (key === " " || /^[pPзЗ]$/.test(key)) return "toggle";
  return "other";
}

export function wavHeader(bytes: number, rate = 16000, channels = 1) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + bytes, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(bytes, 40);
  return header;
}

async function readPcm(path: string) {
  const file = Bun.file(path);
  if (file.size < 44) return null;
  const header = Buffer.from(await file.slice(0, 12).arrayBuffer());
  if (
    header.toString("ascii", 0, 4) !== "RIFF" ||
    header.toString("ascii", 8, 12) !== "WAVE"
  )
    return null;
  for (let offset = 12; offset + 8 <= file.size;) {
    const chunk = Buffer.from(
      await file.slice(offset, offset + 8).arrayBuffer(),
    );
    const size = chunk.readUInt32LE(4);
    if (chunk.toString("ascii", 0, 4) === "data")
      return Buffer.from(
        await file
          .slice(offset + 8, Math.min(offset + 8 + size, file.size))
          .arrayBuffer(),
      );
    offset += 8 + size + (size % 2);
  }
  return null;
}

export async function mergeWav(sources: string[], target: string) {
  const parts: Buffer[] = [];
  for (const source of sources) {
    const pcm = await readPcm(source).catch(() => null);
    if (pcm?.length) parts.push(pcm);
  }
  if (!parts.length) return 0;
  const data = Buffer.concat(parts);
  await Bun.write(target, Buffer.concat([wavHeader(data.length), data]));
  return data.length / 32000;
}

function reader() {
  const queue: string[] = [];
  let pending: ((key: string) => void) | null = null;
  const onData = (chunk: Buffer) => {
    const key = chunk.toString();
    if (pending) {
      const resolve = pending;
      pending = null;
      resolve(key);
    } else queue.push(key);
  };
  process.stdin.setRawMode?.(true);
  process.stdin.resume();
  process.stdin.on("data", onData);
  return {
    next: () =>
      queue.length
        ? Promise.resolve(queue.shift()!)
        : new Promise<string>((resolve) => {
            pending = resolve;
          }),
    close: () => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode?.(false);
      process.stdin.pause();
    },
  };
}

const line = (text: string) => process.stdout.write(`\r${text.padEnd(70)}`);

async function quit(child: Bun.Subprocess<"pipe", "ignore", "pipe">) {
  try {
    child.stdin.write("q");
    await child.stdin.flush();
  } catch {}
  if ((await Promise.race([child.exited, Bun.sleep(5000)])) === undefined)
    child.kill();
  await child.exited;
}

export async function record(device?: string): Promise<Recording> {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error(
      "Запись требует интерактивный терминал. Укажите готовый файл вместо команды record.",
    );
  const c = config();
  const ffmpeg = await executable(c.ffmpeg);
  const input = audioInput();
  if (!input.format)
    throw new Error(
      "Запись с микрофона поддерживается на macOS и Linux. Для другой системы задайте AUDIO_FORMAT и AUDIO_DEVICE.",
    );
  const chosen = device || input.device;
  const directory = await mkdtemp(join(tmpdir(), "whisper101-"));
  const path = join(directory, "recording.wav");
  const discard = () => rm(directory, { recursive: true, force: true });
  const segments: string[] = [];
  const keys = reader();
  let recorded = 0;
  let cancelled = false;
  let stopped = false;
  let failure = "";
  console.log(
    `Микрофон: ${chosen}. Пробел - пауза, Enter - остановить, Ctrl+C - отменить.`,
  );
  try {
    while (!cancelled && !stopped && recorded < maxSeconds) {
      const segment = join(directory, `segment-${segments.length}.wav`);
      const child = Bun.spawn(
        recordCommand(
          ffmpeg,
          input.format,
          chosen,
          segment,
          maxSeconds - recorded,
        ),
        { stdin: "pipe", stdout: "ignore", stderr: "pipe" },
      );
      const errors = new Response(child.stderr).text();
      const started = performance.now();
      const ticker = setInterval(
        () =>
          line(
            `Запись: ${recordingLabel(recorded + (performance.now() - started) / 1000)}   пробел - пауза`,
          ),
        1000,
      );
      let action = "ended";
      try {
        while (action === "ended") {
          const key = await Promise.race([
            keys.next(),
            child.exited.then(() => null),
          ]);
          if (key === null) break;
          const value = pressed(key);
          if (value !== "other") action = value;
        }
      } finally {
        clearInterval(ticker);
      }
      await quit(child);
      failure = await errors;
      segments.push(segment);
      recorded += (await wavDuration(segment).catch(() => null)) || 0;
      if (action === "cancel") cancelled = true;
      if (action !== "toggle") break;
      line(`Пауза: ${recordingLabel(recorded)}   пробел - продолжить`);
      let paused = true;
      while (paused) {
        const value = pressed(await keys.next());
        if (value === "toggle") paused = false;
        else if (value === "stop") {
          paused = false;
          stopped = true;
        } else if (value === "cancel") {
          paused = false;
          cancelled = true;
        }
      }
    }
  } finally {
    keys.close();
    line("");
    process.stdout.write("\r");
  }
  if (cancelled) {
    await discard();
    throw new Cancelled("Запись отменена.");
  }
  const seconds = await mergeWav(segments, path);
  if (!seconds) {
    await discard();
    throw new Error(
      `Не удалось записать звук. Проверьте доступ к микрофону и устройство ввода.\n${failure.slice(-2500)}`,
    );
  }
  if (seconds < 0.5) {
    await discard();
    throw new Error("Запись слишком короткая. Попробуйте ещё раз.");
  }
  await Promise.all(segments.map((file) => rm(file, { force: true })));
  console.log(
    `Записано: ${recordingLabel(seconds)}${segments.length > 1 ? ` · фрагментов: ${segments.length}` : ""}`,
  );
  return { path, seconds, discard };
}
