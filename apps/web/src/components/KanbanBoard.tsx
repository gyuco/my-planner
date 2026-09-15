import { useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Board, TaskStatus } from "@my-planner/core";
import type { BoardTask } from "./TaskCard";
import { TaskCard } from "./TaskCard";
import { ApiRequestError, moveTask } from "../api";

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: "draft", label: "Draft" },
  { status: "in_progress", label: "In progress" },
  { status: "done", label: "Done" },
];

function columnDroppableId(status: TaskStatus): string {
  return `column-${status}`;
}

interface KanbanBoardProps {
  board: Board;
  showProject?: boolean;
  onBoardChange: () => void;
  onTaskClick?: (task: BoardTask) => void;
}

interface SortableTaskCardProps {
  task: BoardTask;
  status: TaskStatus;
  showProject?: boolean;
  onClick?: () => void;
}

function SortableTaskCard({ task, status, showProject, onClick }: SortableTaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { status },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <TaskCard
      task={task}
      showProject={showProject}
      onClick={onClick}
      dragRef={setNodeRef}
      dragAttributes={attributes}
      dragListeners={listeners}
      style={style}
      isDragging={isDragging}
    />
  );
}

interface ColumnProps {
  status: TaskStatus;
  label: string;
  tasks: BoardTask[];
  showProject?: boolean;
  onTaskClick?: (task: BoardTask) => void;
}

function Column({ status, label, tasks, showProject, onTaskClick }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: columnDroppableId(status), data: { status } });
  const items = tasks.map((t) => t.id);

  return (
    <div
      className={`column${isOver ? " column-drag-over" : ""}`}
      ref={setNodeRef}
    >
      <h2>
        {label} <span className="column-count">{tasks.length}</span>
      </h2>
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        {tasks.map((task) => (
          <SortableTaskCard
            key={task.id}
            task={task}
            status={status}
            showProject={showProject}
            onClick={() => onTaskClick?.(task)}
          />
        ))}
      </SortableContext>
    </div>
  );
}

export function KanbanBoard({ board, showProject, onBoardChange, onTaskClick }: KanbanBoardProps) {
  const [dragError, setDragError] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);
    const activeStatus = (active.data.current?.status as TaskStatus | undefined) ?? null;
    if (!activeStatus) return;

    const overIdStr = String(over.id);
    let targetStatus: TaskStatus;
    let targetIndex: number;

    if (overIdStr.startsWith("column-")) {
      targetStatus = overIdStr.slice("column-".length) as TaskStatus;
      targetIndex = (board[targetStatus] as BoardTask[]).length;
    } else {
      targetStatus = (over.data.current?.status as TaskStatus | undefined) ?? activeStatus;
      const targetTasks = board[targetStatus] as BoardTask[];
      const idx = targetTasks.findIndex((t) => t.id === overIdStr);
      targetIndex = idx === -1 ? targetTasks.length : idx;
    }

    if (activeStatus === targetStatus) {
      const tasks = board[targetStatus] as BoardTask[];
      const activeIndex = tasks.findIndex((t) => t.id === activeId);
      if (activeIndex !== -1 && activeIndex < targetIndex) {
        targetIndex -= 1;
      }
      if (activeIndex === targetIndex) return;
    }

    setDragError(null);
    try {
      await moveTask(activeId, targetStatus, targetIndex);
      onBoardChange();
    } catch (err) {
      if (err instanceof ApiRequestError) {
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
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="board">
          {COLUMNS.map((col) => (
            <Column
              key={col.status}
              status={col.status}
              label={col.label}
              tasks={board[col.status] as BoardTask[]}
              showProject={showProject}
              onTaskClick={onTaskClick}
            />
          ))}
        </div>
      </DndContext>
    </div>
  );
}
