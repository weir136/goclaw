import { useState } from "react";
import { ClipboardList, Check, X, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import type { TeamTaskData } from "@/types/team";
import { taskStatusBadgeVariant, isTaskActionable } from "./task-utils";
import { TaskDetailDialog } from "./task-detail-dialog";

interface TaskListProps {
  tasks: TeamTaskData[];
  loading: boolean;
  onApprove: (taskId: string) => Promise<void>;
  onReject: (taskId: string, reason?: string) => Promise<void>;
}

export function TaskList({ tasks, loading, onApprove, onReject }: TaskListProps) {
  const { t } = useTranslation("teams");
  const [selectedTask, setSelectedTask] = useState<TeamTaskData | null>(null);

  if (loading && tasks.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        {t("tasks.loading")}
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <ClipboardList className="h-8 w-8 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">{t("tasks.noTasks")}</p>
        <p className="text-xs text-muted-foreground">
          {t("tasks.noTasksDescription")}
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-lg border">
        <div className="grid min-w-[500px] grid-cols-[1fr_110px_100px_60px_80px] items-center gap-2 border-b bg-muted/50 px-4 py-2.5 text-xs font-medium text-muted-foreground">
          <span>{t("tasks.columns.subject")}</span>
          <span>{t("tasks.columns.status")}</span>
          <span>{t("tasks.columns.owner")}</span>
          <span>{t("tasks.columns.priority")}</span>
          <span className="text-right">{t("tasks.columns.actions")}</span>
        </div>
        {tasks.map((task) => (
          <div
            key={task.id}
            className="grid min-w-[500px] cursor-pointer grid-cols-[1fr_110px_100px_60px_80px] items-center gap-2 border-b px-4 py-3 last:border-0 hover:bg-muted/30"
            onClick={() => setSelectedTask(task)}
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{task.subject}</p>
              {task.description && (
                <p className="truncate text-xs text-muted-foreground/70">
                  {task.description}
                </p>
              )}
              {task.result && (
                <p className="mt-0.5 line-clamp-1 text-xs text-emerald-600 dark:text-emerald-400">
                  {task.result}
                </p>
              )}
            </div>
            <Badge variant={taskStatusBadgeVariant(task.status)}>
              {t(`tasks.status.${task.status}`, task.status.replace("_", " "))}
            </Badge>
            <span className="truncate text-sm text-muted-foreground">
              {task.owner_agent_key || "—"}
            </span>
            <span className="text-sm text-muted-foreground">
              {task.priority}
            </span>
            <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              {task.status === "pending_approval" && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-emerald-600 hover:text-emerald-700"
                    title={t("tasks.actions.approve")}
                    onClick={() => onApprove(task.id)}
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive/80"
                    title={t("tasks.actions.reject")}
                    onClick={() => onReject(task.id)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </>
              )}
              {isTaskActionable(task.status) && task.status !== "pending_approval" && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive hover:text-destructive/80"
                  title={t("tasks.actions.cancel")}
                  onClick={() => onReject(task.id, "Cancelled by user")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      {selectedTask && (
        <TaskDetailDialog
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
          onApprove={onApprove}
          onReject={onReject}
        />
      )}
    </>
  );
}
