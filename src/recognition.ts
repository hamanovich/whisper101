export type Recognition = {
  durationSeconds: number | null;
  language: string | null;
  meanTokenProbability: number | null;
  lowProbabilityTokens: number;
  scoredTokens: number;
};

export function recognitionScores(
  value: unknown,
): Omit<Recognition, "durationSeconds"> {
  const data = value as {
    result?: { language?: unknown };
    transcription?: { tokens?: { text?: unknown; p?: unknown }[] }[];
  } | null;
  const probabilities: number[] = [];
  for (const segment of Array.isArray(data?.transcription)
    ? data.transcription
    : []) {
    for (const token of Array.isArray(segment?.tokens) ? segment.tokens : []) {
      if (
        typeof token?.text !== "string" ||
        !token.text.trim() ||
        token.text.trim().startsWith("[_")
      )
        continue;
      if (
        typeof token.p === "number" &&
        Number.isFinite(token.p) &&
        token.p >= 0 &&
        token.p <= 1
      )
        probabilities.push(token.p);
    }
  }
  return {
    language:
      typeof data?.result?.language === "string" ? data.result.language : null,
    meanTokenProbability: probabilities.length
      ? probabilities.reduce((a, b) => a + b, 0) / probabilities.length
      : null,
    lowProbabilityTokens: probabilities.filter((p) => p < 0.5).length,
    scoredTokens: probabilities.length,
  };
}

export async function wavDuration(path: string): Promise<number | null> {
  const file = Bun.file(path);
  const header = Buffer.from(await file.slice(0, 12).arrayBuffer());
  if (
    header.toString("ascii", 0, 4) !== "RIFF" ||
    header.toString("ascii", 8, 12) !== "WAVE"
  )
    return null;
  let byteRate = 0;
  for (let offset = 12; offset + 8 <= file.size;) {
    const chunk = Buffer.from(
      await file.slice(offset, offset + 8).arrayBuffer(),
    );
    const size = chunk.readUInt32LE(4);
    if (offset + 8 + size > file.size) return null;
    const type = chunk.toString("ascii", 0, 4);
    if (type === "fmt " && size >= 16) {
      const format = Buffer.from(
        await file.slice(offset + 8, offset + 24).arrayBuffer(),
      );
      if (format.readUInt16LE(0) !== 1) return null;
      byteRate = format.readUInt32LE(8);
    }
    if (type === "data" && byteRate > 0) return size / byteRate;
    offset += 8 + size + (size % 2);
  }
  return null;
}

export function recordingLabel(seconds: number | null) {
  if (seconds === null) return "длительность недоступна";
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}
