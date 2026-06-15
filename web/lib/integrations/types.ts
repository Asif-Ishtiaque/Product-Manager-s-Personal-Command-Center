// Shared shapes for Tide integrations. Each source implements `Integration`;
// the registry wires them up so routes/sync stay provider-agnostic.

export type Source = "jira" | "figma" | "clickup" | "slack" | "notion";

export const SOURCES: Source[] = ["jira", "figma", "clickup", "slack", "notion"];

export type OAuthToken = {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  externalAccountId?: string | null; // cloud/team/workspace id
  workspaceName?: string | null; // human label or base url
  scope?: string | null;
};

export interface Integration {
  source: Source;
  label: string;
  /** Build the provider's OAuth authorize URL (state = CSRF token). */
  authorizeUrl(state: string): string;
  /** Exchange the ?code from the callback for tokens. */
  exchangeCode(code: string): Promise<OAuthToken>;
  /** Optional: refresh an expired access token. */
  refresh?(refreshToken: string): Promise<OAuthToken>;
  /** Pull this source's attention items into the DB; returns count. */
  sync(userId: string): Promise<number>;
}
