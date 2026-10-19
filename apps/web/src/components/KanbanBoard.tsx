import { useEffect, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { TASK_STATUSES, type Board, type TaskStatus } from "@my-planner/core";
import type { BoardTask } from "./TaskCard";
import { TaskCard } from "./TaskCard";
import { ApiRequestError, moveTask } from "../api";
import { useI18n } from "../i18n";

/** Preferenza locale (per browser) delle colonne visibili: non tocca il server. */
const VISIBLE_COLUMNS_STORAGE_KEY = "my-planner-visible-columns";

function columnDroppableId(status: TaskStatus): string {
  return `column-${status}`;
}

/** Legge le colonne salvate localmente, scartando valori sconosciuti o vuoti. */
function getStoredVisibleStatuses(): TaskStatus[] {
  try {
    const raw = localStorage.getItem(VISIBLE_COLUMNS_STORAGE_KEY);
    if (!raw) return [...TASK_STATUSES];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...TASK_STATUSES];
    const valid = TASK_STATUSES.filter((status) => parsed.includes(status));
    return valid.length > 0 ? valid : [...TASK_STATUSES];
  } catch {
    return [...TASK_STATUSES];
  }
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
      className={`column column-status-${status}${isOver ? " column-drag-over" : ""}`}
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

function findTaskById(board: Board, id: string): BoardTask | undefined {
  for (const status of TASK_STATUSES) {
    const found = (board[status] as BoardTask[]).find((t) => t.id === id);
    if (found) return found;
  }
  return undefined;
}

/** Sposta `taskId` in `targetStatus`/`targetIndex` in una copia del board, per l'update ottimistico. */
function reorderBoard(board: Board, taskId: string, targetStatus: TaskStatus, targetIndex: number): Board {
  const next = {} as Record<TaskStatus, BoardTask[]>;
  for (const status of TASK_STATUSES) {
    next[status] = [...(board[status] as BoardTask[])];
  }
  let moved: BoardTask | undefined;
  for (const status of TASK_STATUSES) {
    const list = next[status];
    const idx = list.findIndex((t) => t.id === taskId);
    if (idx !== -1) {
      moved = { ...list[idx], status: targetStatus };
      list.splice(idx, 1);
      break;
    }
  }
  if (!moved) return board;
  next[targetStatus].splice(targetIndex, 0, moved);
  return next as Board;
}

export function KanbanBoard({ board, showProject, onBoardChange, onTaskClick }: KanbanBoardProps) {
  const { t } = useI18n();
  const COLUMNS: { status: TaskStatus; label: string }[] = [
    { status: "draft", label: t.board.draft },
    { status: "todo", label: t.board.todo },
    { status: "in_progress", label: t.board.inProgress },
    { status: "testing", label: t.board.testing },
    { status: "done", label: t.board.done },
  ];
  const [dragError, setDragError] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<BoardTask | null>(null);
  const [visibleStatuses, setVisibleStatuses] = useState<TaskStatus[]>(getStoredVisibleStatuses);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  // Copia locale per l'update ottimistico: senza questa, la card torna alla
  // posizione originale non appena dnd-kit rilascia (perché `board` non è
  // ancora cambiato) e poi salta in avanti quando arriva la risposta del
  // server — l'effetto "va e torna indietro" segnalato.
  const [localBoard, setLocalBoard] = useState<Board>(board);

  useEffect(() => {
    setLocalBoard(board);
  }, [board]);

  // La configurazione delle colonne resta solo nel browser: nessuna chiamata
  // al server, così ogni utente può avere la propria vista.
  useEffect(() => {
    try {
      localStorage.setItem(VISIBLE_COLUMNS_STORAGE_KEY, JSON.stringify(visibleStatuses));
    } catch {
      /* ignore (storage non disponibile) */
    }
  }, [visibleStatuses]);

  useEffect(() => {
    if (!pickerOpen) return;
    function handlePointerDown(event: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setPickerOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setPickerOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [pickerOpen]);

  function toggleColumn(status: TaskStatus) {
    setVisibleStatuses((current) => {
      const next = current.includes(status)
        ? current.filter((s) => s !== status)
        : [...current, status];
      // Almeno una colonna deve restare visibile, altrimenti la board
      // diventerebbe uno spazio vuoto senza modo evidente di recuperarla.
      if (next.length === 0) return current;
      return TASK_STATUSES.filter((s) => next.includes(s));
    });
  }

  const visibleColumns = COLUMNS.filter((col) => visibleStatuses.includes(col.status));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  function handleDragStart(event: DragStartEvent) {
    document.body.classList.add("dnd-dragging");
    setActiveTask(findTaskById(localBoard, String(event.active.id)) ?? null);
  }

  function handleDragCancel() {
    document.body.classList.remove("dnd-dragging");
    setActiveTask(null);
  }

  async function handleDragEnd(event: DragEndEvent) {
    document.body.classList.remove("dnd-dragging");
    setActiveTask(null);
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
      targetIndex = (localBoard[targetStatus] as BoardTask[]).length;
    } else {
      targetStatus = (over.data.current?.status as TaskStatus | undefined) ?? activeStatus;
      const targetTasks = localBoard[targetStatus] as BoardTask[];
      const idx = targetTasks.findIndex((t) => t.id === overIdStr);
      targetIndex = idx === -1 ? targetTasks.length : idx;
    }

    const previousBoard = localBoard;
    if (activeStatus === targetStatus) {
      const tasks = localBoard[targetStatus] as BoardTask[];
      const activeIndex = tasks.findIndex((t) => t.id === activeId);
      if (activeIndex !== -1 && activeIndex < targetIndex) {
        targetIndex -= 1;
      }
      if (activeIndex === targetIndex) return;
    }

    // Applica subito lo spostamento in locale, prima della risposta server.
    setLocalBoard(reorderBoard(localBoard, activeId, targetStatus, targetIndex));
    setDragError(null);
    try {
      await moveTask(activeId, targetStatus, targetIndex);
      onBoardChange();
    } catch (err) {
      // Il server ha rifiutato la mossa (es. DEPENDENCY_BLOCKED): torna allo
      // stato precedente invece di lasciare la UI disallineata dal server.
      setLocalBoard(previousBoard);
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
      <div className="board-toolbar">
        <div className="column-picker" ref={pickerRef}>
          <button
            type="button"
            className={`filter-chip column-picker-toggle${pickerOpen ? " active" : ""}`}
            onClick={() => setPickerOpen((open) => !open)}
            aria-haspopup="true"
            aria-expanded={pickerOpen}
            title={t.board.columnsMenuTitle}
          >
            {t.board.columns} · {visibleStatuses.length}/{TASK_STATUSES.length}
          </button>
          {pickerOpen && (
            <div className="column-picker-menu" role="group" aria-label={t.board.columnsMenuTitle}>
              <div className="column-picker-title">{t.board.columnsMenuTitle}</div>
              {COLUMNS.map((col) => {
                const checked = visibleStatuses.includes(col.status);
                return (
                  <label key={col.status} className="column-picker-item">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={checked && visibleStatuses.length === 1}
                      onChange={() => toggleColumn(col.status)}
                    />
                    <span className={`column-picker-dot column-picker-dot-${col.status}`} />
                    <span>{col.label}</span>
                  </label>
                );
              })}
              <button
                type="button"
                className="column-picker-reset"
                onClick={() => setVisibleStatuses([...TASK_STATUSES])}
              >
                {t.board.showAllColumns}
              </button>
            </div>
          )}
        </div>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragCancel={handleDragCancel}
        onDragEnd={handleDragEnd}
      >
        <div className="board">
          {visibleColumns.map((col) => (
            <Column
              key={col.status}
              status={col.status}
              label={col.label}
              tasks={localBoard[col.status] as BoardTask[]}
              showProject={showProject}
              onTaskClick={onTaskClick}
            />
          ))}
        </div>
        <DragOverlay>
          {activeTask && <TaskCard task={activeTask} showProject={showProject} isDragging />}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
