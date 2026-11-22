import { afterEach, expect, it, vi } from 'vitest';
import { deliverInvitations } from '../../worker/src/events/delivery';
import { deferred } from '../helpers/background';

const message = {
  from: 'noreply@ainooga.org',
  replyTo: 'contact@ainooga.org',
  subject: 'Meeting',
  text: 'Join us.',
  html: '<p>Join us.</p>',
};

afterEach(() => vi.useRealTimers());

it('holds the sixth send while five are pending and counts one provider rejection', async () => {
  vi.useFakeTimers();
  const recipients = Array.from({ length: 6 }, (_, i) => `p${i}@example.com`);
  const gates = Array.from({ length: 5 }, () => deferred());
  const attempted: string[] = [];
  const email: SendEmail = {
    async send({ to }) {
      const gate = gates[attempted.length];
      attempted.push(String(to));
      if (gate) await gate.promise;
      return { messageId: String(to) };
    },
  };
  const pending = deliverInvitations(email, recipients, message);
  await vi.advanceTimersByTimeAsync(0);
  expect(attempted).toEqual(recipients.slice(0, 5));
  gates[0]!.reject(new Error('Private provider details'));
  for (const gate of gates.slice(1)) gate.resolve();
  expect(await pending).toEqual({ recipients: 6, accepted: 5, failed: 1 });
  expect(attempted).toEqual(recipients);
  expect(vi.getTimerCount()).toBe(0);
});

it('reports uncertain delivery at ten seconds without retrying a late acceptance', async () => {
  vi.useFakeTimers();
  const finish = deferred();
  let attempts = 0;
  const email: SendEmail = {
    async send() {
      attempts++;
      await finish.promise;
      return { messageId: 'late' };
    },
  };
  let completed = false;
  const pending = deliverInvitations(email, ['p@example.com'], message).then((result) => {
    completed = true;
    return result;
  });
  await vi.advanceTimersByTimeAsync(9_999);
  expect(completed).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(completed).toBe(true);
  expect(await pending).toEqual({ recipients: 1, accepted: 0, failed: 1 });
  finish.resolve();
  await vi.runAllTimersAsync();
  expect(attempts).toBe(1);
});
