import { useEffect, useState } from "react";
import type { TaskAssignee } from "@my-planner/core";
import { listProjectAssignees } from "../api";
import { useI18n } from "../i18n";

interface AssigneeSelectProps {
  projectId: string;
  value: string | null;
  onChange: (assigneeId: string | null) => void;
  disabled?: boolean;
}

/** Select dell'assegnatario: admin e membri del progetto (GET /projects/:id/assignees). */
export function AssigneeSelect({ projectId, value, onChange, disabled }: AssigneeSelectProps) {
  const { t } = useI18n();
  const [assignees, setAssignees] = useState<TaskAssignee[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    listProjectAssignees(projectId)
      .then((list) => {
        if (!cancelled) setAssignees(list);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return (
    <label>
      {t.assignee.label}
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        disabled={disabled || error}
        title={error ? t.assignee.loadError : undefined}
      >
        <option value="">{t.assignee.unassigned}</option>
        {assignees.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </label>
  );
}
