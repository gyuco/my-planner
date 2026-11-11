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
import { ApiRequestError, addComment, moveTask } from "../api";
import { SendBackModal } from "./SendBackModal";
import { DoneTasksModal } from "./DoneTasksModal";
import { ArchiveCheckIcon } from "./Icons";
import { useTouchBoard } from "../lib/useTouchBoard";
import { useI18n } from "../i18n";

/**
 * Colonne della board: "done" non e' una colonna. Un task in Testing si chiude
 * con il pulsante Done sulla card; i completati si consultano nella tabella
 * aperta dal pulsante "Completati" della toolbar.
 */
const BOARD_STATUSES: TaskStatus[] = TASK_STATUSES.filter((s) => s !== "done");

/** Durata dell'animazione di uscita della card chiusa (allineata al CSS). */
const LEAVE_ANIMATION_MS = 420;

/** Preferenza locale (per browser) delle colonne visibili: non tocca il server. */
const VISIBLE_COLUMNS_STORAGE_KEY = "my-planner-visible-columns";

function columnDroppableId(status: TaskStatus): string {
  return `column-${status}`;
}

/** Legge le colonne salvate localmente, scartando valori sconosciuti o vuoti. */
function getStoredVisibleStatuses(): TaskStatus[] {
  try {
    const raw = localStorage.getItem(VISIBLE_COLUMNS_STORAGE_KEY);
    if (!raw) return [...BOARD_STATUSES];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...BOARD_STATUSES];
    const valid = BOARD_STATUSES.filter((status) => parsed.includes(status));
    return valid.length > 0 ? valid : [...BOARD_STATUSES];
  } catch {
    return [...BOARD_STATUSES];
  }
}

interface KanbanBoardProps {
  board: Board;
  /** Cambio progetto in corso: colonne con placeholder al posto delle card. */
  loading?: boolean;
  showProject?: boolean;
  onBoardChange: () => void;
  onTaskClick?: (task: BoardTask) => void;
}

interface SortableTaskCardProps {
  task: BoardTask;
  status: TaskStatus;
  showProject?: boolean;
  onClick?: () => void;
  onAlignStatus?: (task: BoardTask, status: TaskStatus) => void;
  onComplete?: (task: BoardTask) => void;
  onSendBack?: (task: BoardTask) => void;
  leaving?: boolean;
  /** Mobile/touch: niente drag, spostamento dal menu della card. */
  moveTargets?: { status: TaskStatus; label: string }[];
  onMove?: (task: BoardTask, status: TaskStatus) => void;
}

function SortableTaskCard({
  task,
  status,
  showProject,
  onClick,
  onAlignStatus,
  onComplete,
  onSendBack,
  leaving,
  moveTargets,
  onMove,
}: SortableTaskCardProps) {
  const dragDisabled = Boolean(onMove);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { status },
    disabled: dragDisabled,
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
      dragAttributes={dragDisabled ? undefined : attributes}
      dragListeners={dragDisabled ? undefined : listeners}
      style={style}
      isDragging={isDragging}
      onAlignStatus={onAlignStatus ? (next) => onAlignStatus(task, next) : undefined}
      onComplete={onComplete ? () => onComplete(task) : undefined}
      onSendBack={onSendBack ? () => onSendBack(task) : undefined}
      leaving={leaving}
      moveTargets={moveTargets}
      onMove={onMove ? (next) => onMove(task, next) : undefined}
    />
  );
}

interface ColumnProps {
  status: TaskStatus;
  label: string;
  tasks: BoardTask[];
  showProject?: boolean;
  onTaskClick?: (task: BoardTask) => void;
  onAlignStatus?: (task: BoardTask, status: TaskStatus) => void;
  onComplete?: (task: BoardTask) => void;
  onSendBack?: (task: BoardTask) => void;
  leavingIds?: ReadonlySet<string>;
  moveTargets?: { status: TaskStatus; label: string }[];
  onMove?: (task: BoardTask, status: TaskStatus) => void;
}

function Column({
  status,
  label,
  tasks,
  showProject,
  onTaskClick,
  onAlignStatus,
  onComplete,
  onSendBack,
  leavingIds,
  moveTargets,
  onMove,
}: ColumnProps) {
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
            onAlignStatus={onAlignStatus}
            onComplete={onComplete}
            onSendBack={onSendBack}
            leaving={leavingIds?.has(task.id)}
            moveTargets={moveTargets}
            onMove={onMove}
          />
        ))}
      </SortableContext>
    </div>
  );
}

/** Numero di card fittizie per colonna: varia per non sembrare una griglia. */
const SKELETON_CARDS = [2, 3, 1, 2, 1];

function SkeletonCard({ wide }: { wide: boolean }) {
  return (
    <div className="skeleton-card" aria-hidden="true">
      <div className="skeleton-row">
        <span className="skeleton skeleton-pill" />
        <span className="skeleton skeleton-pill skeleton-pill-short" />
      </div>
      <span className={`skeleton skeleton-line${wide ? "" : " skeleton-line-short"}`} />
      {wide && <span className="skeleton skeleton-line skeleton-line-short" />}
    </div>
  );
}

function SkeletonColumn({ status, label, index }: { status: TaskStatus; label: string; index: number }) {
  const count = SKELETON_CARDS[index % SKELETON_CARDS.length];
  return (
    <div className={`column column-status-${status} column-loading`}>
      <h2>
        {label} <span className="skeleton skeleton-count" />
      </h2>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} wide={(i + index) % 2 === 0} />
      ))}
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

export function KanbanBoard({ board, loading, showProject, onBoardChange, onTaskClick }: KanbanBoardProps) {
  const { t } = useI18n();
  const COLUMNS: { status: TaskStatus; label: string }[] = [
    { status: "draft", label: t.board.draft },
    { status: "todo", label: t.board.todo },
    { status: "in_progress", label: t.board.inProgress },
    { status: "testing", label: t.board.testing },
  ];
  const [dragError, setDragError] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<BoardTask | null>(null);
  const [visibleStatuses, setVisibleStatuses] = useState<TaskStatus[]>(getStoredVisibleStatuses);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  // Card in uscita dopo "Done" (animazione) e task da rimandare in In progress.
  const [leavingIds, setLeavingIds] = useState<ReadonlySet<string>>(new Set());
  const [sendBackTask, setSendBackTask] = useState<BoardTask | null>(null);
  const [sendBackBusy, setSendBackBusy] = useState(false);
  const [sendBackError, setSendBackError] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const touchBoard = useTouchBoard();
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
      return BOARD_STATUSES.filter((s) => next.includes(s));
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

  // Allinea lo stato di un parent a quello suggerito dalle sue sotto-task
  // (badge ⚠ sulla card): stesso endpoint del drag, in coda alla colonna.
  async function handleAlignStatus(task: BoardTask, targetStatus: TaskStatus) {
    const previousBoard = localBoard;
    const targetIndex = (localBoard[targetStatus] as BoardTask[]).length;
    setLocalBoard(reorderBoard(localBoard, task.id, targetStatus, targetIndex));
    setDragError(null);
    try {
      await moveTask(task.id, targetStatus);
      onBoardChange();
    } catch (err) {
      setLocalBoard(previousBoard);
      if (err instanceof ApiRequestError) {
        setDragError(err.message);
      }
    }
  }

  // "Done" su una card in Testing: animazione di uscita in parallelo alla
  // chiamata; la card sparisce solo se il server conferma.
  async function handleComplete(task: BoardTask) {
    setDragError(null);
    setLeavingIds((ids) => new Set(ids).add(task.id));
    const withoutLeaving = (ids: ReadonlySet<string>) => {
      const next = new Set(ids);
      next.delete(task.id);
      return next;
    };
    try {
      await Promise.all([
        moveTask(task.id, "done"),
        new Promise((resolve) => setTimeout(resolve, LEAVE_ANIMATION_MS)),
      ]);
      setLocalBoard((b) => reorderBoard(b, task.id, "done", (b.done as BoardTask[]).length));
      setLeavingIds(withoutLeaving);
      onBoardChange();
    } catch (err) {
      setLeavingIds(withoutLeaving);
      setDragError(err instanceof ApiRequestError ? err.message : t.board.completeError);
    }
  }

  // Rimanda in In progress e salva il motivo come commento. Prima lo
  // spostamento (puo' essere bloccato da dipendenze), poi il commento: cosi'
  // un rifiuto del server non lascia commenti orfani.
  async function handleSendBackConfirm(message: string) {
    if (!sendBackTask) return;
    setSendBackBusy(true);
    setSendBackError(null);
    try {
      await moveTask(sendBackTask.id, "in_progress");
      await addComment(sendBackTask.id, message);
      setSendBackTask(null);
      onBoardChange();
    } catch (err) {
      setSendBackError(err instanceof ApiRequestError ? err.message : t.board.sendBackError);
    } finally {
      setSendBackBusy(false);
    }
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
        {sendBackTask && (
          <SendBackModal
            task={sendBackTask}
            busy={sendBackBusy}
            error={sendBackError}
            onCancel={() => {
              setSendBackTask(null);
              setSendBackError(null);
            }}
            onConfirm={handleSendBackConfirm}
          />
        )}
        {showDone && (
          <DoneTasksModal
            tasks={localBoard.done as BoardTask[]}
            showProject={showProject}
            onClose={() => setShowDone(false)}
            onTaskClick={onTaskClick}
          />
        )}
        {loading && (
          <span className="board-loading" role="status">
            <span className="spinner" aria-hidden="true" />
            {t.board.loadingProject}
          </span>
        )}
        <button
          type="button"
          className="filter-chip done-toggle"
          onClick={() => setShowDone(true)}
          disabled={loading}
        >
          <ArchiveCheckIcon /> {t.board.doneButton}
          <span className="done-toggle-count">{loading ? "–" : (localBoard.done as BoardTask[]).length}</span>
        </button>
        <div className="column-picker" ref={pickerRef}>
          <button
            type="button"
            className={`filter-chip column-picker-toggle${pickerOpen ? " active" : ""}`}
            onClick={() => setPickerOpen((open) => !open)}
            aria-haspopup="true"
            aria-expanded={pickerOpen}
            title={t.board.columnsMenuTitle}
          >
            {t.board.columns} · {visibleStatuses.length}/{BOARD_STATUSES.length}
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
                onClick={() => setVisibleStatuses([...BOARD_STATUSES])}
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
        <div className="board" aria-busy={loading || undefined}>
          {loading
            ? visibleColumns.map((col, index) => (
                <SkeletonColumn key={col.status} status={col.status} label={col.label} index={index} />
              ))
            : visibleColumns.map((col) => (
            <Column
              key={col.status}
              status={col.status}
              label={col.label}
              tasks={localBoard[col.status] as BoardTask[]}
              showProject={showProject}
              onTaskClick={onTaskClick}
              onAlignStatus={handleAlignStatus}
              onComplete={col.status === "testing" ? handleComplete : undefined}
              onSendBack={col.status === "testing" ? (task) => setSendBackTask(task) : undefined}
              leavingIds={leavingIds}
              moveTargets={touchBoard ? COLUMNS.filter((c) => c.status !== col.status) : undefined}
              onMove={touchBoard ? handleAlignStatus : undefined}
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
