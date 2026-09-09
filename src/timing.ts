export function formatDuration(milliseconds: number) {
  const tenths = Math.round(milliseconds / 100);
  const seconds = ((tenths % 600) / 10).toFixed(1);
  return tenths < 600
    ? `${seconds} с`
    : `${Math.floor(tenths / 600)} мин ${seconds} с`;
}

export async function timed<T>(
  label: string,
  operation: () => Promise<T>,
): Promise<T> {
  const start = performance.now();
  let completed = false;
  try {
    const result = await operation();
    completed = true;
    return result;
  } finally {
    console.log(
      `${label}: ${formatDuration(performance.now() - start)}${completed ? "" : " (прервано ошибкой)"}`,
    );
  }
}
