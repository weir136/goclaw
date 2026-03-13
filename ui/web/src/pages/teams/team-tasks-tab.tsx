import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMinLoading } from "@/hooks/use-min-loading";
import { toast } from "@/stores/use-toast-store";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TeamTaskData } from "@/types/team";
import { TaskList } from "./task-sections";

interface TeamTasksTabProps {
  teamId: string;
  getTeamTasks: (teamId: string, statusFilter?: string, userId?: string) => Promise<{ tasks: TeamTaskData[]; count: number }>;
  getKnownUsers: (teamId: string) => Promise<string[]>;
  onApprove: (taskId: string) => Promise<void>;
  onReject: (taskId: string, reason?: string) => Promise<void>;
}

const STATUS_FILTERS = ["all", "active", "completed"] as const;

export function TeamTasksTab({ teamId, getTeamTasks, getKnownUsers, onApprove, onReject }: TeamTasksTabProps) {
  const { t } = useTranslation("teams");
  const [tasks, setTasks] = useState<TeamTaskData[]>([]);
  const [loading, setLoading] = useState(true);
  const spinning = useMinLoading(loading);

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [userFilter, setUserFilter] = useState<string>("");
  const [knownUsers, setKnownUsers] = useState<string[]>([]);

  // Load known users once
  useEffect(() => {
    getKnownUsers(teamId).then(setKnownUsers).catch(() => {});
  }, [teamId, getKnownUsers]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getTeamTasks(teamId, statusFilter, userFilter || undefined);
      setTasks(res.tasks ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [teamId, getTeamTasks, statusFilter, userFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const handleApprove = useCallback(async (taskId: string) => {
    try {
      await onApprove(taskId);
      toast.success(t("toast.taskApproved"));
      load();
    } catch {
      toast.error(t("toast.failedApproveTask"));
    }
  }, [onApprove, load, t]);

  const handleReject = useCallback(async (taskId: string, reason?: string) => {
    try {
      await onReject(taskId, reason);
      toast.success(t("toast.taskCancelled"));
      load();
    } catch {
      toast.error(t("toast.failedCancelTask"));
    }
  }, [onReject, load, t]);

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Status filter toggle buttons */}
        <div className="flex rounded-md border">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={
                "px-3 py-1.5 text-xs font-medium transition-colors first:rounded-l-md last:rounded-r-md" +
                (statusFilter === f
                  ? " bg-primary text-primary-foreground"
                  : " hover:bg-muted")
              }
            >
              {t(`tasks.filter.${f}`)}
            </button>
          ))}
        </div>

        {/* User filter dropdown */}
        {knownUsers.length > 0 && (
          <Select value={userFilter} onValueChange={(v) => setUserFilter(v === "_all" ? "" : v)}>
            <SelectTrigger className="h-8 w-auto min-w-[140px] text-xs">
              <SelectValue placeholder={t("tasks.filter.allUsers")} />
            </SelectTrigger>
            <SelectContent position="popper" className="max-h-[50vh] sm:max-h-96">
              <SelectItem value="_all">{t("tasks.filter.allUsers")}</SelectItem>
              {knownUsers.map((u) => (
                <SelectItem key={u} value={u}>{u}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <div className="ml-auto">
          <Button variant="outline" size="sm" onClick={load} disabled={spinning} className="gap-1">
            <RefreshCw className={"h-3.5 w-3.5" + (spinning ? " animate-spin" : "")} /> {t("tasks.refresh")}
          </Button>
        </div>
      </div>

      <TaskList
        tasks={tasks}
        loading={loading}
        onApprove={handleApprove}
        onReject={handleReject}
      />
    </div>
  );
}
