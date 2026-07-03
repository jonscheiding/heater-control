function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function formatUpcoming(startIso: string, now: number): string {
  const start = new Date(startIso);
  const startDay = startOfDay(start);
  const today = startOfDay(new Date(now));
  const timeStr = start.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  if (startDay.getTime() === today.getTime()) return `today at ${timeStr}`;

  const tomorrow = new Date(today.getTime() + 86_400_000);
  if (startDay.getTime() === tomorrow.getTime())
    return `tomorrow at ${timeStr}`;

  const dayStr = start.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return `${dayStr} at ${timeStr}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function toDatetimeLocalString(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function toTopOfReasonableHour(d: Date): Date {
  const HOUR = 60 * 60 * 1000;
  return new Date(Math.floor((d.getTime() + HOUR * 1.5) / HOUR) * HOUR);
}
