export interface DbClient {
  insertSubscriber(email: string, name: string | null, token: string): Promise<boolean>;
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
  AUTH_READY?: string;
  AUTH_SECRET?: string;
  ORGANIZER_API_TOKENS?: string;
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  AUTH_RATE_LIMITER?: { limit(input: { key: string }): Promise<{ success: boolean }> };
  DB: D1Database;
  CHAPTER_SCHEMA_READY?: string;
  EMAIL: SendEmail;
  TURNSTILE_SECRET_KEY: string;
  SITE_URL: string;
}
