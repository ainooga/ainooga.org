import type { DbClient } from '../types.js';
import { confirmSubscription, insertSubscriber } from './newsletter.js';
import { normalizeEmail } from './identifiers.js';

export function createDb(db: D1Database): DbClient {
  return {
    insertSubscriber: (email, name, token) => insertSubscriber(db, email, name, token),
    async findSubscriberByEmail(email) {
      return db
        .prepare(
          `SELECT s.id FROM subscriptions s
        JOIN person_identifiers i ON i.person_id = s.person_id
        WHERE i.kind = 'email' AND i.normalized_value = ? AND s.kind = 'newsletter'`,
        )
        .bind(normalizeEmail(email))
        .first<{ id: number }>();
    },
    confirmSubscription: (token) => confirmSubscription(db, token),
    async insertContactRequest(data) {
      await db
        .prepare(
          `INSERT INTO contact_requests
        (submitted_name, submitted_phone, preferred_date, preferred_time, source)
        VALUES (?, ?, ?, ?, 'sponsor')`,
        )
        .bind(
          data.name,
          data.phone,
          data.preferredDate ?? null,
          data.preferredTime ?? null,
        )
        .run();
    },
  };
}
