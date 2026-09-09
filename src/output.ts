import { mkdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";

export async function createOutputDirectory(
  parent: string,
  input: string,
  date = new Date(),
) {
  await mkdir(parent, { recursive: true });
  const name =
    basename(input, extname(input))
      .replace(/[^\p{L}\p{N}_-]+/gu, "-")
      .slice(0, 70) || "recording";
  const day = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
  for (let attempt = 1; ; attempt++) {
    const out = join(
      parent,
      `${name}-${day}${attempt === 1 ? "" : `-${attempt}`}`,
    );
    try {
      await mkdir(out);
      return out;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
}
