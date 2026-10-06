import type { SqlStore } from '../../db/types';

const members =
  'WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<200)';

export async function seedChapter(store: SqlStore) {
  await store.execute([
    `${members} INSERT INTO people (id,name,professional_role)
      SELECT x,'Synthetic Member '||x,'Chapter participant' FROM n`,
    `INSERT INTO person_identifiers (id,person_id,kind,value,normalized_value)
      SELECT id,id,'email','member'||id||'@example.com','member'||id||'@example.com' FROM people`,
    `INSERT INTO person_identifiers (person_id,kind,value,normalized_value)
      SELECT id,'phone','+1202555'||printf('%04d',id),'+1202555'||printf('%04d',id) FROM people`,
    `INSERT INTO person_identifiers (person_id,kind,value,normalized_value)
      SELECT id,'linkedin','https://example.com/profile/'||id,'https://example.com/profile/'||id FROM people`,
    `INSERT INTO person_sources (id,person_id,source,source_key)
      SELECT id,id,'ai_collective','synthetic-'||id FROM people`,
    "INSERT INTO person_tags(person_id,tag) SELECT id,'member' FROM people",
    "INSERT INTO organizations(id,name) SELECT id,'Example Company '||id FROM people WHERE id<=20",
    "INSERT INTO organization_people SELECT (id%20)+1,id,'employee' FROM people",
    `INSERT INTO subscriptions (person_id,email_identifier_id,kind,status,source)
      SELECT id,id,'event_invites',CASE WHEN id<=2 THEN 'unsubscribed' ELSE 'unknown' END,'ai_collective' FROM people`,
    `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<10)
      INSERT INTO events (id,name,starts_at) SELECT x,'Synthetic Event '||x,'2026-01-01T00:00:00.000Z' FROM n`,
    "INSERT INTO event_links (event_id,platform,external_id,url) SELECT id,'synthetic','event-'||id,'https://example.com/event/'||id FROM events",
    `WITH RECURSIVE n(x) AS (SELECT 0 UNION ALL SELECT x+1 FROM n WHERE x<733)
      INSERT INTO event_participation (event_id,person_id,registration_status,source)
      SELECT (x%10)+1,(x/10)+1,CASE WHEN x<502 THEN 'invited' WHEN x<702 THEN 'approved'
        WHEN x<730 THEN 'declined' WHEN x<732 THEN 'pending_approval' ELSE 'waitlist' END,'synthetic' FROM n`,
  ]);
}

export async function seedPoll(store: SqlStore, id: number) {
  await store.execute([
    `INSERT INTO polls (id,slug,title,description,status,identity_mode,min_selections,max_selections,
      allow_write_ins,results_visibility,starts_at,ends_at,allow_edits,created_by,eligible_tags)
      VALUES (${id},'capacity-${id}','Synthetic topic poll','Choose two topics for a future chapter meeting.',
      'published','honor',2,2,1,'after_vote','2026-01-01T00:00:00.000Z','2099-01-01T00:00:00.000Z',1,1,'["member"]')`,
    `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<30)
      INSERT INTO poll_options (id,poll_id,label,normalized_label,position,origin,created_by_person_id)
      SELECT (${id}-1)*30+x,${id},'Topic '||x,'topic '||x,x,
      CASE WHEN x<=10 THEN 'predefined' ELSE 'write_in' END,CASE WHEN x<=10 THEN NULL ELSE x-10 END FROM n`,
    `INSERT INTO poll_ballots (poll_id,person_id,revision,request_id,payload_hash,attempt_nonce)
      SELECT ${id},id,1,printf('00000000-0000-4000-8000-%012d',id),printf('%064d',id),printf('%064d',id) FROM people`,
    `INSERT INTO poll_ballot_choices (ballot_id,poll_id,option_id)
      SELECT id,poll_id,(${id}-1)*30+(person_id%30)+1 FROM poll_ballots WHERE poll_id=${id}
      UNION ALL SELECT id,poll_id,(${id}-1)*30+((person_id+1)%30)+1 FROM poll_ballots WHERE poll_id=${id}`,
  ]);
}

export async function seedTemporaryAuth(store: SqlStore) {
  await store.execute([
    `INSERT INTO voter_sessions (token_hash,person_id,identifier_id,identifier_value,assurance,poll_id,created_at,expires_at)
      SELECT printf('%064d',id),id,id,'member'||id||'@example.com','honor',1,
      '2026-01-01T00:00:00.000Z','2026-01-02T00:00:00.000Z' FROM people`,
    `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<1000)
      INSERT INTO auth_challenges (id,kind,poll_id,browser_hash,created_at,expires_at)
      SELECT printf('%064d',x),'discord',1,printf('%064d',x),
      '2026-01-01T00:00:00.000Z','2026-01-01T00:10:00.000Z' FROM n`,
  ]);
}
