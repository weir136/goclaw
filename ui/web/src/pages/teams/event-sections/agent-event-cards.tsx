import { Badge } from "@/components/ui/badge";
import type { TeamEventEntry } from "@/stores/use-team-event-store";
import type { EnrichedAgentEventPayload } from "@/types/team-events";

interface Props {
  entry: TeamEventEntry;
  resolveAgent: (keyOrId: string | undefined) => string;
}

export function AgentEventCard({ entry, resolveAgent }: Props) {
  const p = entry.payload as EnrichedAgentEventPayload;
  const subtype = p.type;

  const subtypeBadgeVariant =
    subtype === "run.completed"
      ? ("success" as const)
      : subtype === "run.failed"
        ? ("destructive" as const)
        : subtype === "run.started" || subtype === "run.retrying"
          ? ("info" as const)
          : ("secondary" as const);

  return (
    <div className="space-y-1 text-sm">
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <Badge variant={subtypeBadgeVariant} className="shrink-0 font-mono text-xs">
          {subtype}
        </Badge>
        <span className="truncate font-medium">{resolveAgent(p.agentId)}</span>
        {p.delegationId && (
          <span className="shrink-0 text-xs text-muted-foreground">
            deleg: {p.delegationId.slice(0, 8)}
          </span>
        )}
        {p.parentAgentId && (
          <span className="truncate text-xs text-muted-foreground">
            parent: {resolveAgent(p.parentAgentId)}
          </span>
        )}
      </div>

      {(subtype === "tool.call" || subtype === "tool.result") && p.payload && (
        <div className="flex items-center gap-1 text-xs">
          {p.payload.name && (
            <span className="truncate font-mono font-medium">{p.payload.name}</span>
          )}
          {p.payload.is_error && (
            <Badge variant="destructive" className="shrink-0 text-xs">error</Badge>
          )}
        </div>
      )}

      {subtype === "run.failed" && p.payload?.error && (
        <p className="break-words text-xs text-destructive line-clamp-2">{p.payload.error}</p>
      )}
    </div>
  );
}
