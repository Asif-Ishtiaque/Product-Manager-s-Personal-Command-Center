import { prisma } from "@/lib/prisma";
import { encrypt, decrypt } from "@/lib/encryption";
import type { OAuthToken, Source } from "./types";

// Persist a connection with tokens encrypted at rest.
export async function saveConnection(userId: string, source: Source, t: OAuthToken) {
  const data = {
    externalAccountId: t.externalAccountId ?? null,
    workspaceName: t.workspaceName ?? null,
    accessTokenEnc: encrypt(t.accessToken),
    refreshTokenEnc: t.refreshToken ? encrypt(t.refreshToken) : null,
    expiresAt: t.expiresAt ?? null,
    scope: t.scope ?? null,
  };
  return prisma.connection.upsert({
    where: { userId_source: { userId, source } },
    create: { userId, source, ...data },
    update: data,
  });
}

type RefreshFn = (refreshToken: string) => Promise<OAuthToken>;

// Return a usable access token + the connection row, refreshing first if
// the token is expired (or within 60s of it) and a refresh path exists.
export async function getAccessToken(userId: string, source: Source, refresh?: RefreshFn) {
  const conn = await prisma.connection.findUnique({
    where: { userId_source: { userId, source } },
  });
  if (!conn) return null;

  let access = decrypt(conn.accessTokenEnc);
  const nearExpiry = conn.expiresAt && conn.expiresAt.getTime() < Date.now() + 60_000;
  if (nearExpiry && conn.refreshTokenEnc && refresh) {
    const t = await refresh(decrypt(conn.refreshTokenEnc));
    await saveConnection(userId, source, t);
    access = t.accessToken;
  }
  return { access, conn };
}

type ItemData = {
  title: string;
  description?: string | null;
  url?: string | null;
  priority?: string;
  status?: string | null;
  chip?: string | null;
  dueAt?: Date | null;
  updatedAtSource?: Date | null;
  raw?: unknown;
};

// Upsert one normalized attention item.
export async function upsertItem(
  userId: string,
  connectionId: string,
  source: Source,
  externalId: string,
  data: ItemData
) {
  const payload = {
    ...data,
    priority: data.priority ?? "p2",
    raw: (data.raw ?? undefined) as object | undefined,
  };
  return prisma.item.upsert({
    where: { userId_source_externalId: { userId, source, externalId } },
    create: { userId, connectionId, source, externalId, ...payload },
    update: payload,
  });
}

export async function markSynced(connectionId: string) {
  await prisma.connection.update({
    where: { id: connectionId },
    data: { lastSyncedAt: new Date() },
  });
}

// Priority heuristic shared by sources that carry a due date.
export function priorityFromDue(dueAt: Date | null, urgent = false): string {
  if (urgent) return "p0";
  if (!dueAt) return "p2";
  const ms = dueAt.getTime() - Date.now();
  if (ms < 0) return "p0";
  if (ms < 24 * 3600 * 1000) return "p1";
  return "p2";
}
