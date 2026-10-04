import { marked } from 'marked';
import DOMPurify from 'dompurify';
import type { PollDetail } from './types';

export function descriptionHtml(source: string): string {
  return DOMPurify.sanitize(marked.parse(source, { async: false }), {
    ALLOWED_TAGS: [
      'p',
      'br',
      'strong',
      'em',
      'del',
      'h2',
      'h3',
      'h4',
      'ul',
      'ol',
      'li',
      'blockquote',
      'pre',
      'code',
      'a',
      'hr',
    ],
    ALLOWED_ATTR: ['href', 'title'],
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP: /^(?:https?:\/\/|mailto:)/i,
  });
}
export function dateLabel(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'long',
  }).format(new Date(value));
}
export function selectionRule(p: PollDetail): string {
  if (p.minSelections === p.maxSelections) return `Choose exactly ${p.minSelections}.`;
  if (p.maxSelections === null)
    return `Choose at least ${p.minSelections}; there is no maximum.`;
  return `Choose ${p.minSelections} to ${p.maxSelections}.`;
}
export function votingState(p: PollDetail, now: number): 'upcoming' | 'closed' | 'open' {
  if (now < Date.parse(p.startsAt)) return 'upcoming';
  return now >= Date.parse(p.endsAt) ? 'closed' : 'open';
}
export function canEdit(p: PollDetail, now: number): boolean {
  return (
    votingState(p, now) === 'open' &&
    p.allowEdits &&
    now < Date.parse(p.editDeadline ?? p.endsAt)
  );
}
export function canSeeResults(p: PollDetail): boolean {
  return (
    p.resultsVisibility === 'before_vote' ||
    (p.resultsVisibility === 'after_vote' && p.ballot !== null)
  );
}
export function selectedCount(p: PollDetail, ids: number[], writeIn: string): number {
  const normalize = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  const existing = p.options.find(
    (option) => normalize(option.label) === normalize(writeIn),
  );
  return (
    new Set(ids).size +
    Number(
      writeIn.trim() !== '' && (existing === undefined || !ids.includes(existing.id)),
    )
  );
}
