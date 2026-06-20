export function formatTime(t: Date): string {
  const hours = t.getHours();
  const minutes = t.getMinutes();
  const hour = ((hours + 11) % 12) + 1;
  const suffix = hours < 12 ? 'a' : 'p';
  return minutes === 0
    ? `${hour}${suffix}`
    : `${hour}:${String(minutes).padStart(2, '0')}${suffix}`;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function sameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

function sameYear(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear();
}

function currentYear(): number {
  return new Date().getFullYear();
}

/** Returns 'numeric' when the given year differs from the current year. */
function y(yr: number): Intl.DateTimeFormatOptions['year'] {
  return yr !== currentYear() ? 'numeric' : undefined;
}

/**
 * Build the end-date portion of a range string, dropping components that match
 * the start date. `fmtEnd` must be bound to the end date.
 */
function rangeEnd(
  start: Date,
  end: Date,
  fmtEnd: (opts: Intl.DateTimeFormatOptions) => string,
  style: 'long' | 'short',
): string {
  if (!sameYear(start, end)) {
    return fmtEnd({ month: style, day: 'numeric', year: y(end.getFullYear()) });
  }
  if (!sameMonth(start, end)) {
    return fmtEnd({ month: style, day: 'numeric' });
  }
  return fmtEnd({ day: 'numeric' });
}

/**
 * Format an event date range, collapsing redundant parts.
 *
 * Rules:
 * - If the event year matches the current year, the year is omitted everywhere.
 * - For the end date, any component (year, month, day) that matches the start
 *   is omitted.
 * - Time is shown in the concise format: "9a", "5p", "1:30p" (no space before a/p).
 * - For single-day events the time range is appended after `·`.
 * - For multi-day events just the date range is shown.
 */
export function formatEventRange(dateStr: string, endDateStr?: string): string {
  const start = new Date(dateStr);
  const end = endDateStr == null ? null : new Date(endDateStr);

  const fmt: (opts: Intl.DateTimeFormatOptions) => string = (opts) =>
    start.toLocaleDateString('en-US', opts);
  const fmtEnd: (opts: Intl.DateTimeFormatOptions) => string = (opts) =>
    end!.toLocaleDateString('en-US', opts);

  // No end date — just a single date
  if (end === null) {
    return fmt({
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: y(start.getFullYear()),
    });
  }

  // Same-day event — date once, then time range
  if (sameDay(start, end)) {
    const datePart = fmt({
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: y(start.getFullYear()),
    });
    return `${datePart} · ${formatTime(start)}–${formatTime(end)}`;
  }

  // Multi-day — build start and end, dropping matching parts from end
  const startPart = fmt({
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: y(start.getFullYear()),
  });
  const endPart = rangeEnd(start, end, fmtEnd, 'long');

  return `${startPart} – ${endPart}`;
}

/** Concise date for list cards (short month, 3-letter weekday). */
export function formatEventCardRange(dateStr: string, endDateStr?: string): string {
  const start = new Date(dateStr);
  const end = endDateStr == null ? null : new Date(endDateStr);

  const fmt: (opts: Intl.DateTimeFormatOptions) => string = (opts) =>
    start.toLocaleDateString('en-US', opts);
  const fmtEnd: (opts: Intl.DateTimeFormatOptions) => string = (opts) =>
    end!.toLocaleDateString('en-US', opts);

  if (end === null) {
    return fmt({
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: y(start.getFullYear()),
    });
  }

  if (sameDay(start, end)) {
    return fmt({
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: y(start.getFullYear()),
    });
  }

  const startPart = fmt({
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: y(start.getFullYear()),
  });
  const endPart = rangeEnd(start, end, fmtEnd, 'short');

  return `${startPart} – ${endPart}`;
}

export function isPast(iso: string): boolean {
  return new Date(iso) < new Date();
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
