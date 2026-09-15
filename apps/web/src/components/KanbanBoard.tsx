import type { TaskStatus } from "@my-planner/core";

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: "draft", label: "Draft" },
  { status: "in_progress", label: "In progress" },
  { status: "done", label: "Done" },
];

interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  projectId?: string;
}

export function KanbanBoard({ tasks }: { tasks: Task[] }) {
  return (
    <div className="board">
      {COLUMNS.map((col) => (
        <div className="column" key={col.status}>
          <h2>{col.label}</h2>
          {tasks
            .filter((t) => t.status === col.status)
            .map((t) => (
              <div className="card" key={t.id}>
                {t.title}
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}
