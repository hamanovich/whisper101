import { resolve } from "node:path";
export async function openLocal(path: string) {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "linux"
        ? "xdg-open"
        : null;
  if (!command || !Bun.which(command)) {
    console.log(`Откройте файл вручную: ${resolve(path)}`);
    return;
  }
  const processHandle = Bun.spawn([command, resolve(path)], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  if ((await processHandle.exited) !== 0)
    throw new Error(`Не удалось открыть. Путь: ${resolve(path)}`);
}
