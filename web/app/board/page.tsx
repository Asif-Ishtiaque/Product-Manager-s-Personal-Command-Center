import { auth, signOut } from "@/auth";
import { prisma } from "@/lib/prisma";
import { slaFlag, urgency, ago } from "@/lib/sla";
import { integrations } from "@/lib/integrations/registry";
import { SOURCES } from "@/lib/integrations/types";
import { redirect } from "next/navigation";
import RefreshButton from "./RefreshButton";

export const dynamic = "force-dynamic";

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { connected, error } = await searchParams;

  const [items, connections] = await Promise.all([
    prisma.item.findMany({ where: { userId: session.user.id } }),
    prisma.connection.findMany({ where: { userId: session.user.id } }),
  ]);

  const sorted = items.sort((a, b) => urgency(a) - urgency(b));
  const connectedSet = new Set(connections.map((c) => c.source));
  const unconnected = SOURCES.filter((s) => !connectedSet.has(s));

  async function logout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <div className="wrap">
      <div className="bar">
        <div className="brand">
          <h1>
            Tide<span className="dot">.</span>
          </h1>
          <div className="sub">Jira × Figma × ClickUp × Slack × Notion · Personal Ops Board</div>
        </div>
        <div className="bar-actions">
          <span className="who">{session.user.email}</span>
          <RefreshButton />
          <form action={logout}>
            <button type="submit" className="btn">Log out</button>
          </form>
        </div>
      </div>

      {connected && integrations[connected as keyof typeof integrations] && (
        <div className="banner">✓ {integrations[connected as keyof typeof integrations].label} connected — syncing into your feed.</div>
      )}
      {error && <div className="banner err">Something went wrong ({error}). Try connecting again.</div>}

      {unconnected.length > 0 && (
        <div className="connect-strip">
          <span className="connect-label">Connect a source:</span>
          {unconnected.map((s) => (
            <a key={s} className={`btn connect-${s}`} href={`/api/connect/${s}`}>
              + {integrations[s].label}
            </a>
          ))}
        </div>
      )}

      <section className="panel">
        <div className="head">
          <h2>⚑ Attention Required</h2>
          <span className="count">{sorted.length}</span>
        </div>

        {sorted.length === 0 ? (
          <div className="empty">
            {connections.length > 0 ? (
              <>No items yet. Hit <b>↻ Sync</b> to pull from your connected tools.</>
            ) : (
              <>Nothing here yet. <br /> Connect a source above to populate your attention feed.</>
            )}
          </div>
        ) : (
          sorted.map((it) => {
            const sla = slaFlag(it);
            return (
              <div className="item" key={it.id}>
                <span className={`pri ${it.priority}`} />
                <div>
                  <div className="top">
                    <span className={`tag-src src-${it.source}`}>{it.source}</span>
                    {it.chip && <span className={`chip ${it.chip}`}>{it.chip}</span>}
                    {sla && <span className={`sla ${sla.level}`}>{sla.label}</span>}
                  </div>
                  <div className="title">
                    {it.url ? (
                      <a href={it.url} target="_blank" rel="noopener noreferrer">{it.title}</a>
                    ) : (
                      it.title
                    )}
                  </div>
                  {it.status && <div className="desc">{it.status}</div>}
                </div>
                <div className="when">{ago(it.updatedAtSource)}</div>
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
