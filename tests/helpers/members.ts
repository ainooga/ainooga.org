import { authFixture, ORGANIZER_TOKEN, SITE } from './auth';
import { handleAuth } from '../../worker/src/auth/router';

export { memberInput } from './member-data';

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
