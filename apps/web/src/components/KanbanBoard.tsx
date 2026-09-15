import { useState } from "react";
import type { Board, TaskStatus } from "@my-planner/core";
import type { BoardTask } from "./TaskCard";
import { TaskCard } from "./TaskCard";
import { ApiRequestError, moveTask } from "../api";

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: "draft", label: "Draft" },
  { status: "in_progress", label: "In progress" },
  { status: "done", label: "Done" },
];

interface KanbanBoardProps {
  board: Board;
  showProject?: boolean;
  onBoardChange: () => void;
  onTaskClick?: (task: BoardTask) => void;
}

export function KanbanBoard({ board, showProject, onBoardChange, onTaskClick }: KanbanBoardProps) {
  const [dragError, setDragError] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<TaskStatus | null>(null);

  function handleDragStart(e: React.DragEvent<HTMLDivElement>, taskId: string) {
    e.dataTransfer.setData("text/plain", taskId);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>, status: TaskStatus) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverColumn(status);
  }

  async function handleDrop(e: React.DragEvent<HTMLDivElement>, status: TaskStatus) {
    e.preventDefault();
    setDragOverColumn(null);
    const taskId = e.dataTransfer.getData("text/plain");
    if (!taskId) return;

    setDragError(null);
    try {
      await moveTask(taskId, status);
      onBoardChange();
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "DEPENDENCY_BLOCKED") {
        setDragError(err.message);
      } else if (err instanceof ApiRequestError) {
        setDragError(err.message);
      }
    }
  }

  return (
    <div>
      {dragError && (
        <div className="board-error" role="alert">
          {dragError}
          <button onClick={() => setDragError(null)}>&times;</button>
        </div>
      )}
      <div className="board">
        {COLUMNS.map((col) => (
          <div
            className={`column${dragOverColumn === col.status ? " column-drag-over" : ""}`}
            key={col.status}
            onDragOver={(e) => handleDragOver(e, col.status)}
            onDragLeave={() => setDragOverColumn(null)}
            onDrop={(e) => handleDrop(e, col.status)}
          >
            <h2>
              {col.label} <span className="column-count">{board[col.status].length}</span>
            </h2>
            {(board[col.status] as BoardTask[]).map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                showProject={showProject}
                onDragStart={(e) => handleDragStart(e, task.id)}
                onClick={() => onTaskClick?.(task)}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
