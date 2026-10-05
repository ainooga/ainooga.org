import { z } from 'zod';
import { reject } from './auth/http.js';
import type { EmailSender, TurnstileVerifier } from './types.js';
export { createDb } from './db/client.js';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character]!;
  });
}

async function sendEmail(
  email: SendEmail | undefined,
  message: Parameters<SendEmail['send']>[0],
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (!email) throw new Error('Email unavailable');
    await Promise.race([
      email.send(message),
      new Promise<never>((_resolve, fail) => {
        timer = setTimeout(() => fail(new Error('Delivery timeout')), 10000);
      }),
    ]);
  } catch {
    reject(
      503,
      'delivery_unavailable',
      'Confirmation email could not be sent. Please try again.',
    );
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function createEmailSender(email: SendEmail | undefined): EmailSender {
  return {
    async sendConfirmation(to, name, confirmToken, siteUrl) {
      const url = new URL('/confirm', siteUrl);
      url.searchParams.set('token', confirmToken);
      await sendEmail(email, {
        from: 'noreply@ainooga.org',
        to,
        subject: 'Confirm your subscription to AI Nooga',
        html: `<p>Thanks for joining the AI Nooga mailing list${name ? `, ${escapeHtml(name)}` : ''}!</p>
          <p><a href="${escapeHtml(url.href)}">Click here to confirm</a></p>
          <p>If you didn't sign up, ignore this email.</p>`,
        text: `Thanks for joining the AI Nooga mailing list${name ? `, ${name}` : ''}!\n\nConfirm your subscription at: ${url.href}\n\nIf you didn't sign up, ignore this email.`,
      });
    },
  };
}

const verificationSchema = z.object({
  success: z.boolean(),
  hostname: z.string().optional(),
  action: z.string().optional(),
});

export function createTurnstileVerifier(
  secret: string,
  hostname: string,
  fetcher: typeof fetch = fetch,
): TurnstileVerifier {
  return {
    async verify(token: string): Promise<boolean> {
      try {
        const response = await fetcher(
          'https://challenges.cloudflare.com/turnstile/v0/siteverify',
          {
            method: 'POST',
            signal: AbortSignal.timeout(10000),
            body: new URLSearchParams({ secret, response: token }),
          },
        );
        if (!response.ok) throw new Error('Verification unavailable');
        const parsed = verificationSchema.safeParse(await response.json());
        return (
          parsed.success &&
          parsed.data.success &&
          parsed.data.hostname === hostname &&
          parsed.data.action === 'turnstile-spin-v1'
        );
      } catch {
        return reject(
          503,
          'provider_unavailable',
          'Verification is temporarily unavailable.',
        );
      }
    },
  };
}
