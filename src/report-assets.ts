import { readFileSync } from "node:fs";

const fontRoot = new URL(
  "../node_modules/@fontsource-variable/manrope/",
  import.meta.url,
);
export const fontStyles = readFileSync(new URL("index.css", fontRoot), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(
    /@font-face\s*\{[^}]*manrope-(?:greek|vietnamese|cyrillic-ext)-[^}]*\}/g,
    "",
  )
  .replace(
    /url\(\.\/([^)]*)\)/g,
    (_, path: string) =>
      `url(data:font/woff2;base64,${readFileSync(new URL(path, fontRoot)).toString("base64")})`,
  );

const names = [
  "headphones",
  "download-simple",
  "text-align-left",
  "check-circle",
  "pencil-line",
  "chat-circle-text",
  "book-open",
  "info",
  "file-text",
] as const;
type IconName = (typeof names)[number];
const icons = Object.fromEntries(
  names.map((name) => [
    name,
    readFileSync(
      new URL(
        `../node_modules/@phosphor-icons/core/assets/regular/${name}.svg`,
        import.meta.url,
      ),
      "utf8",
    ).replace(
      "<svg ",
      '<svg class="icon" aria-hidden="true" focusable="false" ',
    ),
  ]),
);
export const icon = (name: IconName) => icons[name]!;
