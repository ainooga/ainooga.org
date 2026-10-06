// All callers bind poll/person aliases, never user-provided SQL identifiers.
export function eligiblePerson(person: string, poll = 'p'): string {
  return `(EXISTS (SELECT 1 FROM person_tags t JOIN json_each(${poll}.eligible_tags) tag ON tag.value=t.tag
    WHERE t.person_id=${person}) OR EXISTS (
      SELECT 1 FROM json_each(${poll}.allowed_person_ids) allowed
      WHERE allowed.type='integer' AND allowed.value=${person}))`;
}
