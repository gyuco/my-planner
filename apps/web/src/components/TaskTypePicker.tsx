import { TASK_TYPES } from "@my-planner/core";
import type { TaskType } from "@my-planner/core";
import { useI18n } from "../i18n";

interface TaskTypePickerProps {
  value: TaskType;
  onChange: (type: TaskType) => void;
}

/** Selettore a pillole del tipo di ticket, ogni tipo col suo colore (vedi .task-type-*). */
export function TaskTypePicker({ value, onChange }: TaskTypePickerProps) {
  const { t } = useI18n();
  return (
    <div className="task-type-picker" role="radiogroup" aria-label={t.taskType.label}>
      {TASK_TYPES.map((type) => (
        <button
          key={type}
          type="button"
          role="radio"
          aria-checked={value === type}
          className={`task-type-option task-type-${type}${value === type ? " is-active" : ""}`}
          onClick={() => onChange(type)}
        >
          <span className="task-type-dot" aria-hidden="true" />
          {t.taskType[type]}
        </button>
      ))}
    </div>
  );
}
