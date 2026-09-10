import { entry } from "./src/cli";
const args = Bun.argv.slice(2);
await entry(
  args[0]?.toLowerCase().endsWith(".txt") &&
    !args.some((arg) => arg === "--task" || arg.startsWith("--task="))
    ? ["analyze", ...args]
    : args,
);
