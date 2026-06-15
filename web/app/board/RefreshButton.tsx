"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export default function RefreshButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);

  async function resync() {
    setBusy(true);
    try {
      await fetch("/api/sync", { method: "POST" });
      start(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  return (
    <button className="btn" onClick={resync} disabled={busy || pending}>
      {busy || pending ? "Syncing…" : "↻ Sync"}
    </button>
  );
}
