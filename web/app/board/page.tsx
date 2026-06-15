import { auth, signOut } from "@/auth";
import { prisma } from "@/lib/prisma";
import { slaFlag, urgency, ago } from "@/lib/sla";
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
  const notionConnected = connections.some((c) => c.source === "notion");

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
          {!notionConnected && (
            <a className="btn amber" href="/api/connect/notion">+ Connect Notion</a>
          )}
          <RefreshButton />
          <form action={logout}>
            <button type="submit" className="btn">Log out</button>
          </form>
        </div>
      </div>

      {connected === "notion" && <div className="banner">✓ Notion connected — your pages are syncing into the feed.</div>}
      {error && <div className="banner err">Something went wrong ({error}). Try connecting again.</div>}

      <section className="panel">
        <div className="head">
          <h2>⚑ Attention Required</h2>
          <span className="count">{sorted.length}</span>
        </div>

        {sorted.length === 0 ? (
          <div className="empty">
            {notionConnected ? (
              <>No items yet. Hit <b>↻ Sync</b> to pull from Notion.</>
            ) : (
              <>Nothing here yet. <br /> Connect Notion to populate your attention feed.</>
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
