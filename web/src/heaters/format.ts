export function formatRemaining(
  finishesAtIso: string,
  now: number,
): string | null {
  const ms = new Date(finishesAtIso).getTime() - now;
  if (ms <= 0) return null;
  const totalMinutes = Math.ceil(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `Auto-off in ${hours}h ${minutes}m`;
  return `Auto-off in ${minutes}m`;
}
