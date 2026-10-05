import { authFixture, ORGANIZER_TOKEN, SITE } from './auth';
import type { MemberInput } from '../../worker/src/members/schemas';
import { handleAuth } from '../../worker/src/auth/router';

export function memberInput(): MemberInput {
  return {
    source: 'synthetic',
    sourceKey: 'member-1',
    email: 'member@example.com',
    name: 'Example Member',
    company: 'Example Company',
    professionalRole: 'Engineer',
    phone: '+1 (555) 010-0100',
    linkedin: '/in/example-member',
    tags: ['volunteer'],
    eventInvites: {
      status: 'unknown' as 'unknown' | 'unsubscribed',
      unsubscribedAt: null as string | null,
    },
    participations: [
      {
        event: {
          platform: 'luma',
          externalId: 'event-1',
          url: 'https://lu.ma/example',
          name: 'Example event',
          startsAt: '2026-01-01T18:00:00.000Z',
          endsAt: '2026-01-01T20:00:00.000Z',
          timezone: 'America/New_York',
          location: 'Example venue',
          capacity: 50,
        },
        registrationStatus: 'approved' as const,
      },
    ],
  };
}

export async function memberFixture() {
  const f = await authFixture();
  const call = (body: unknown, preview = false, headers: Record<string, string> = {}) =>
    handleAuth(
      new Request(`${SITE}/api/admin/members/import${preview ? '/preview' : ''}`, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: {
          Origin: SITE,
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ORGANIZER_TOKEN}`,
          ...headers,
        },
      }),
      f.env,
      f.deps,
      f.deps,
    );
  return { ...f, importMember: call };
}
