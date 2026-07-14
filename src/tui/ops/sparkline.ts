/** Minimal ASCII sparkline from a series of numbers. */

const BARS = "▁▂▃▄▅▆▇█";

export function sparkline(values: number[], width = 40): string {
  if (values.length === 0) {
    return "(no samples yet — wait a few seconds)";
  }
  const slice = values.length > width ? values.slice(-width) : values;
  const min = Math.min(...slice);
  const max = Math.max(...slice);
  const span = max - min || 1;
  return slice
    .map((v) => {
      const idx = Math.min(BARS.length - 1, Math.floor(((v - min) / span) * (BARS.length - 1)));
      return BARS[idx]!;
    })
    .join("");
}

export function ringPush(buf: number[], value: number, max = 60): void {
  buf.push(value);
  while (buf.length > max) {
    buf.shift();
  }
}
