export interface DbClient {
  insertSubscriber(email: string, name: string | null, token: string): Promise<void>;
  findSubscriberByEmail(email: string): Promise<Record<string, unknown> | null>;
  confirmSubscription(token: string): Promise<number>;
  insertContactRequest(data: {
    name: string;
    phone: string;
    preferredDate?: string;
    preferredTime?: string;
  }): Promise<void>;
}

export interface EmailSender {
  sendConfirmation(
    to: string,
    name: string | null,
    confirmToken: string,
    siteUrl: string,
  ): Promise<void>;
}

export interface TurnstileVerifier {
  verify(token: string): Promise<boolean>;
}

export interface Env {
  DB: D1Database;
  EMAIL: SendEmail;
  TURNSTILE_SECRET_KEY: string;
  SITE_URL: string;
}
