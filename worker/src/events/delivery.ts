import type { eventInvitationMessage } from './message.js';

async function send(
  email: SendEmail,
  message: Parameters<SendEmail['send']>[0],
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      email.send(message),
      new Promise<never>((_resolve, fail) => {
        timer = setTimeout(() => fail(new Error('Invitation send timed out')), 10000);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function deliverInvitations(
  email: SendEmail,
  recipients: string[],
  message: ReturnType<typeof eventInvitationMessage>,
) {
  const summary = { recipients: recipients.length, accepted: 0, failed: 0 };
  for (let offset = 0; offset < recipients.length; offset += 5) {
    const outcomes = await Promise.allSettled(
      recipients.slice(offset, offset + 5).map((to) => send(email, { ...message, to })),
    );
    for (const outcome of outcomes) {
      if (outcome.status === 'fulfilled') summary.accepted++;
      else summary.failed++;
    }
  }
  return summary;
}
