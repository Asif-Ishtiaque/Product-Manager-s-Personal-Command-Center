import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getIntegration } from "@/lib/integrations/registry";
import { NextResponse } from "next/server";

// Re-pull every source the user has connected. Each runs independently so
// one failing provider can't blank the others.
export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const connections = await prisma.connection.findMany({
    where: { userId: session.user.id },
    select: { source: true },
  });

  const synced: Record<string, number | string> = {};
  await Promise.all(
    connections.map(async ({ source }) => {
      const integration = getIntegration(source);
      if (!integration) return;
      try {
        synced[source] = await integration.sync(session.user.id);
      } catch (e) {
        synced[source] = `error: ${String(e)}`;
      }
    })
  );

  return NextResponse.json({ ok: true, synced });
}
