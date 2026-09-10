import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  audioInput,
  maxSeconds,
  mergeWav,
  parseAudioDevices,
  pressed,
  recordCommand,
  wavHeader,
} from "../src/record";
import { wavDuration } from "../src/recognition";
import { argumentsFor } from "../src/cli";

test("record command takes no file, accepts a device and rejects device elsewhere", () => {
  expect(argumentsFor(["record"]).command).toBe("record");
  expect(argumentsFor(["record"]).file).toBeUndefined();
  expect(argumentsFor(["record", "--device", ":1"]).values.device).toBe(":1");
  expect(argumentsFor(["record", "--task", "coach"]).values.task).toBe("coach");
  expect(() => argumentsFor(["record", "voice.m4a"])).toThrow();
  expect(() => argumentsFor(["--device", ":1", "voice.m4a"])).toThrow();
  expect(argumentsFor(["progress"]).command).toBe("progress");
  expect(() => argumentsFor(["progress", "voice.m4a"])).toThrow();
});

test("audio input follows the platform and honours environment overrides", () => {
  const format = process.env.AUDIO_FORMAT;
  const device = process.env.AUDIO_DEVICE;
  delete process.env.AUDIO_FORMAT;
  delete process.env.AUDIO_DEVICE;
  try {
    expect(audioInput("darwin")).toEqual({
      format: "avfoundation",
      device: ":default",
    });
    expect(audioInput("linux")).toEqual({ format: "pulse", device: "default" });
    expect(audioInput("win32").format).toBe("");
    process.env.AUDIO_FORMAT = "dshow";
    process.env.AUDIO_DEVICE = "audio=Mic";
    expect(audioInput("win32")).toEqual({
      format: "dshow",
      device: "audio=Mic",
    });
  } finally {
    if (format === undefined) delete process.env.AUDIO_FORMAT;
    else process.env.AUDIO_FORMAT = format;
    if (device === undefined) delete process.env.AUDIO_DEVICE;
    else process.env.AUDIO_DEVICE = device;
  }
});

test("recording writes whisper ready audio, caps the length and keeps stdin free for stopping", () => {
  const command = recordCommand(
    "/bin/ffmpeg",
    "avfoundation",
    ":1",
    "/tmp/a.wav",
  );
  expect(command[0]).toBe("/bin/ffmpeg");
  expect(command.at(-1)).toBe("/tmp/a.wav");
  expect(command).not.toContain("-nostdin");
  for (const [flag, value] of [
    ["-f", "avfoundation"],
    ["-i", ":1"],
    ["-ar", "16000"],
    ["-ac", "1"],
    ["-c:a", "pcm_s16le"],
    ["-t", String(maxSeconds)],
  ])
    expect(command[command.indexOf(flag!) + 1]).toBe(value!);
});

test("device listing keeps audio inputs and ignores cameras and noise", () => {
  const devices = parseAudioDevices(
    [
      "[AVFoundation indev @ 0x7f8] AVFoundation video devices:",
      "[AVFoundation indev @ 0x7f8] [0] FaceTime HD Camera",
      "[AVFoundation indev @ 0x7f8] [1] Capture screen 0",
      "[AVFoundation indev @ 0x7f8] AVFoundation audio devices:",
      "[AVFoundation indev @ 0x7f8] [0] MacBook Pro Microphone",
      "[AVFoundation indev @ 0x7f8] [1] Внешний микрофон",
      ": Input/output error",
    ].join("\n"),
  );
  expect(devices).toEqual([
    { id: ":0", name: "MacBook Pro Microphone" },
    { id: ":1", name: "Внешний микрофон" },
  ]);
  expect(parseAudioDevices("")).toEqual([]);
});

test("keys map to stopping, cancelling and pausing on both keyboard layouts", () => {
  expect(pressed("\r")).toBe("stop");
  expect(pressed("\n")).toBe("stop");
  expect(pressed("\r\n")).toBe("stop");
  expect(pressed("\x03")).toBe("cancel");
  expect(pressed(" ")).toBe("toggle");
  expect(pressed("p")).toBe("toggle");
  expect(pressed("з")).toBe("toggle");
  expect(pressed("a")).toBe("other");
  expect(pressed("\x1b[A")).toBe("other");
});

test("a paused take reuses the remaining time budget for the next segment", () => {
  const command = recordCommand(
    "/bin/ffmpeg",
    "pulse",
    "default",
    "/tmp/b.wav",
    42,
  );
  expect(command[command.indexOf("-t") + 1]).toBe("42");
  expect(
    recordCommand("/bin/ffmpeg", "pulse", "default", "/tmp/b.wav", 0.2)[
      recordCommand(
        "/bin/ffmpeg",
        "pulse",
        "default",
        "/tmp/b.wav",
        0.2,
      ).indexOf("-t") + 1
    ],
  ).toBe("1");
});

test("paused segments join into one recording that keeps the spoken audio in order", async () => {
  const directory = await mkdtemp(join(tmpdir(), "merge-"));
  try {
    const tone = (byte: number, bytes: number) => {
      const data = Buffer.alloc(bytes, byte);
      return Buffer.concat([wavHeader(bytes), data]);
    };
    const first = join(directory, "segment-0.wav");
    const second = join(directory, "segment-1.wav");
    const empty = join(directory, "segment-2.wav");
    await Bun.write(first, tone(1, 32000));
    const tagged = tone(2, 16000);
    const list = Buffer.alloc(20);
    list.write("LIST", 0);
    list.writeUInt32LE(12, 4);
    list.write("INFOISFT", 8);
    await Bun.write(
      second,
      Buffer.concat([
        tagged.subarray(0, 36),
        list,
        tagged.subarray(36, 44),
        tagged.subarray(44),
      ]),
    );
    await Bun.write(empty, wavHeader(0));

    const target = join(directory, "recording.wav");
    const seconds = await mergeWav([first, second, empty], target);
    expect(seconds).toBeCloseTo(1.5);
    expect(await wavDuration(target)).toBeCloseTo(1.5);
    const merged = Buffer.from(await Bun.file(target).arrayBuffer());
    expect(merged.length).toBe(44 + 48000);
    expect(merged[44]).toBe(1);
    expect(merged[44 + 32000]).toBe(2);
    expect(await mergeWav([empty], join(directory, "none.wav"))).toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
