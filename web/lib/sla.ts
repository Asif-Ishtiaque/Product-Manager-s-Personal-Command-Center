// Attention scoring shared across the board — the same triage logic the
// original Tide dashboard used, now server-side over DB items.

export type Attn = {
  priority: string;
  dueAt: Date | null;
  updatedAtSource: Date | null;
};

export function slaFlag(item: Attn): { level: "breach" | "warn"; label: string } | null {
  const now = Date.now();
  if (item.dueAt) {
    const due = item.dueAt.getTime();
    if (due < now) return { level: "breach", label: "overdue" };
    if (due - now < 24 * 36e5) return { level: "warn", label: "due today" };
  }
  if (item.updatedAtSource) {
    const ageH = (now - item.updatedAtSource.getTime()) / 36e5;
    const thresh = item.priority === "p0" ? 4 : item.priority === "p1" ? 24 : 72;
    if (ageH > thresh * 2) return { level: "breach", label: `stale ${fmtAge(ageH)}` };
    if (ageH > thresh) return { level: "warn", label: `stale ${fmtAge(ageH)}` };
  }
  return null;
}

export function urgency(item: Attn): number {
  const sla = slaFlag(item);
  const slaW = sla ? (sla.level === "breach" ? 0 : 1) : 2;
  const priW = item.priority === "p0" ? 0 : item.priority === "p1" ? 1 : 2;
  return priW * 3 + slaW;
}

export function isToday(item: Attn): boolean {
  const now = new Date();
  if (item.priority === "p0") return true;
  if (item.dueAt) {
    if (item.dueAt <= now) return true;
    if (item.dueAt.toDateString() === now.toDateString()) return true;
  }
  return !!slaFlag(item);
}

export function ago(d: Date | null): string {
  if (!d) return "";
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return s + "s";
  if (s < 3600) return Math.floor(s / 60) + "m";
  if (s < 86400) return Math.floor(s / 3600) + "h";
  return Math.floor(s / 86400) + "d";
}

function fmtAge(h: number): string {
  return h < 48 ? Math.round(h) + "h" : Math.round(h / 24) + "d";
}
