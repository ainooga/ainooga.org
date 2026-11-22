export interface EventIndexItem {
  slug: string;
  title: string;
  date: string;
  endDate?: string;
  location?: string;
  excerpt?: string;
  tags: string[];
}

export function isPastEvent(date: string, endDate?: string, now = Date.now()): boolean {
  return Date.parse(endDate ?? date) < now;
}

export function groupEvents(events: EventIndexItem[], now = Date.now()) {
  const upcoming: EventIndexItem[] = [];
  const past: EventIndexItem[] = [];
  for (const event of events) {
    (isPastEvent(event.date, event.endDate, now) ? past : upcoming).push(event);
  }
  const byStart = (a: EventIndexItem, b: EventIndexItem) =>
    Date.parse(a.date) - Date.parse(b.date);
  upcoming.sort(byStart);
  past.sort((a, b) => byStart(b, a));
  return { upcoming, past };
}
