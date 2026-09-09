import { entry } from "./src/cli";
const args = Bun.argv.slice(2);
// Preserve the original `bun index.ts transcript.txt` shortcut.
await entry(
  args[0]?.toLowerCase().endsWith(".txt") &&
    !args.some((arg) => arg === "--task" || arg.startsWith("--task="))
    ? ["analyze", ...args]
    : args,
);
