import type { EmailSender, TurnstileVerifier } from './types.js';
export { createDb } from './db/client.js';

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
