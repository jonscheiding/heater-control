export function formatRemaining(
  finishesAtIso: string,
  now: number,
): string | null {
  const ms = new Date(finishesAtIso).getTime() - now;
  if (ms <= 0) return null;
  const totalMinutes = Math.ceil(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `in ${hours}h ${minutes}m`;
  return `in ${minutes}m`;
}

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

  const minutes = Math.floor((start.getTime() - now) / (60 * 1000));

  if (minutes < 4 * 60) {
    const remaining = formatRemaining(startIso, now);
    if (remaining != null) {
      return remaining;
    }
  }

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

/** Absolute date-time (no relative "in 2h" shortcut) — for detail displays. */
export function formatDateTime(iso: string, now: number): string {
  const start = new Date(iso);
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

function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "today at 1:00 PM – 3:00 PM" (end optional, assumed same day). */
export function formatFlightTime(
  startIso: string,
  endIso: string | null,
  now: number,
): string {
  const start = formatDateTime(startIso, now);
  return endIso ? `${start} – ${clockTime(endIso)}` : start;
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
