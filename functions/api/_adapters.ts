import type { DbClient, EmailSender, TurnstileVerifier } from '../lib/types.js';

export function createDb(db: D1Database): DbClient {
  return {
    async insertSubscriber(email, name, token) {
      await db
        .prepare(
          `INSERT INTO subscribers (email, name, source, confirmation_token)
           VALUES (?, ?, 'website', ?)`,
        )
        .bind(email, name, token)
        .run();
    },
    async findSubscriberByEmail(email) {
      return (await db
        .prepare('SELECT id FROM subscribers WHERE email = ?')
        .bind(email)
        .first()) as Record<string, unknown> | null;
    },
    async confirmSubscription(token) {
      const result = await db
        .prepare(
          `UPDATE subscribers SET confirmed = 1, confirmed_at = datetime('now')
           WHERE confirmation_token = ? AND confirmed = 0`,
        )
        .bind(token)
        .run();
      return result.changes;
    },
    async insertContactRequest(data) {
      await db
        .prepare(
          `INSERT INTO contact_requests (name, phone, preferred_date, preferred_time, source)
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

export function createEmailSender(email: SendEmail | undefined): EmailSender {
  return {
    async sendConfirmation(to, name, confirmToken, siteUrl) {
      if (email == null) {
        console.warn(
          `[subscribe] EMAIL binding not configured — confirmation not sent for ${to}`,
        );
        return;
      }
      console.log(
        `[subscribe] Sending confirmation to ${to}${name ? ` (${name})` : ''}...`,
      );
      try {
        await email.send({
          from: 'noreply@ainooga.org',
          to,
          subject: 'Confirm your subscription to AI Nooga',
          html: `
          <p>Thanks for joining the AI Nooga mailing list${name ? `, ${name}` : ''}!</p>
          <p><a href="${siteUrl}/confirm?token=${confirmToken}">Click here to confirm</a></p>
          <p>If you didn't sign up, ignore this email.</p>
        `,
          text: `Thanks for joining the AI Nooga mailing list${name ? `, ${name}` : ''}!\n\nConfirm your subscription at: ${siteUrl}/confirm?token=${confirmToken}\n\nIf you didn't sign up, ignore this email.`,
        });
        console.log(`[subscribe] Confirmation email sent to ${to}`);
      } catch (sendErr) {
        console.error(`[subscribe] Failed to send confirmation to ${to}:`, sendErr);
      }
    },
  };
}

export function createTurnstileVerifier(secret: string): TurnstileVerifier {
  return {
    async verify(token: string): Promise<boolean> {
      const res = await fetch(
        'https://challenges.cloudflare.com/turnstile/v0/siteverify',
        {
          method: 'POST',
          body: new URLSearchParams({ secret, response: token }),
        },
      );
      const data = (await res.json()) as { success: boolean };
      return data.success;
    },
  };
}
