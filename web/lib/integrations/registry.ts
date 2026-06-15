import type { Integration, Source } from "./types";
import { notion } from "./notion";
import { jira } from "./jira";
import { figma } from "./figma";
import { clickup } from "./clickup";
import { slack } from "./slack";

// The single source of truth. Add a provider = add it here.
export const integrations: Record<Source, Integration> = {
  notion,
  jira,
  figma,
  clickup,
  slack,
};

export function getIntegration(source: string): Integration | null {
  return (integrations as Record<string, Integration>)[source] ?? null;
}

export { type Integration, type Source } from "./types";
