export type AuthContext = Pick<ExecutionContext, 'waitUntil'>;

export interface AuthDependencies {
  db: D1Database;
  now(): Date;
  random(): string;
  code(): string;
  sendCode(address: string, code: string): Promise<void>;
  verifyBot(token: string): Promise<boolean>;
  discordIdentity(code: string): Promise<string>;
  limit(key: string): Promise<boolean>;
  limitInitiation(key: string): Promise<boolean>;
  waitUntil(task: Promise<void>): void;
}

export interface Poll {
  id: number;
  slug: string;
  identity_mode: 'honor' | 'verified';
}

export interface Identity {
  id: number;
  person_id: number;
  normalized_value: string;
}

export interface Session {
  person_id: number;
  assurance: 'honor' | 'verified';
  expires_at: string;
}
