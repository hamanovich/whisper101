import { resolve } from "node:path";
import { defaultModel } from "./options";

export const ROOT = resolve(import.meta.dir, "..");
export function config() {
  const whisper =
    process.env.WHISPER_BIN || "../whisper.cpp/build/bin/whisper-cli";
  return {
    ffmpeg: process.env.FFMPEG_BIN || "ffmpeg",
    whisper: whisper.includes("/") ? resolve(ROOT, whisper) : whisper,
    whisperModel: resolve(
      ROOT,
      process.env.WHISPER_MODEL || "../whisper.cpp/models/ggml-medium.bin",
    ),
    model: process.env.OPENAI_MODEL || defaultModel,
    apiKey: process.env.OPENAI_API_KEY,
  };
}
