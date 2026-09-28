import type { SqlStore } from '../../db/types';

export async function seedLegacy(store: SqlStore): Promise<void> {
  await store.execute([
    `INSERT INTO subscribers (id,email,name,source,created_at,confirmed,confirmation_token,confirmed_at)
     VALUES (3,' Legacy@Example.com ','Full Name','website','2026-01-02 03:04:05',0,'old-token',NULL)`,
    `INSERT INTO subscribers (id,email,name,source,created_at,confirmed,confirmation_token,confirmed_at)
     VALUES (8,'confirmed@example.com',NULL,NULL,NULL,1,'used-token','2026-01-03T04:05:06.123Z')`,
    `INSERT INTO contact_requests (id,name,phone,source,created_at,preferred_date,preferred_time)
     VALUES (7,'Inquiry Only','+1 (555) 012-3456',NULL,NULL,'2026-01-04','14:00')`,
  ]);
}
