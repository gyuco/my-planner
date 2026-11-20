import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { TaskAssignee } from "@my-planner/core";
import { listProjectAssignees } from "../api";
import { useI18n } from "../i18n";
import { CheckIcon, ChevronDownIcon } from "./Icons";

interface AssigneeSelectProps {
  projectId: string;
  value: string | null;
  /** Il secondo argomento e' l'assegnatario scelto (null = non assegnato), utile per aggiornamenti ottimistici. */
  onChange: (assigneeId: string | null, assignee: TaskAssignee | null) => void;
  disabled?: boolean;
  /** Nome da mostrare finche' la lista non e' caricata (es. `task.assigneeName`). */
  valueName?: string | null;
}

interface Option {
  id: string | null;
  name: string;
  assignee: TaskAssignee | null;
}

/** Minuscole senza accenti: "Valentín" -> "valentin". */
function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const POPOVER_MAX_HEIGHT = 320;
const POPOVER_MIN_WIDTH = 220;
const GAP = 4;
const VIEWPORT_MARGIN = 8;

/**
 * Select dell'assegnatario con ricerca: admin e membri del progetto
 * (GET /projects/:id/assignees). Il popover e' renderizzato in un portal con
 * `position: fixed` per non essere tagliato dal contenitore scrollabile del
 * drawer; si apre verso l'alto se sotto non c'e' spazio.
 */
export function AssigneeSelect({ projectId, value, onChange, disabled, valueName }: AssigneeSelectProps) {
  const { t } = useI18n();
  const [assignees, setAssignees] = useState<TaskAssignee[]>([]);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({});

  const labelRef = useRef<HTMLLabelElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const optionId = (index: number) => `${baseId}-opt-${index}`;

  const isDisabled = Boolean(disabled || error);

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

  const options = useMemo<Option[]>(() => {
    const q = normalize(query.trim());
    const all = assignees.map((a) => ({ id: a.id, name: a.name, assignee: a }));
    if (!q) return [{ id: null, name: t.assignee.unassigned, assignee: null }, ...all];
    return all.filter((o) => normalize(o.name).includes(q));
  }, [assignees, query, t.assignee.unassigned]);

  const current = value ? assignees.find((a) => a.id === value) : undefined;
  const triggerText = value ? current?.name ?? valueName ?? "" : t.assignee.unassigned;

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  function openPopover() {
    if (isDisabled) return;
    setQuery("");
    const fullIndex = value ? assignees.findIndex((a) => a.id === value) + 1 : 0;
    setHighlight(Math.max(fullIndex, 0));
    setOpen(true);
  }

  function select(option: Option) {
    close(true);
    if (option.id !== value) onChange(option.id, option.assignee);
  }

  // Posizionamento fixed rispetto al trigger: sotto se c'e' spazio, altrimenti sopra.
  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const viewportH = window.innerHeight;
    const viewportW = document.documentElement.clientWidth;
    // Su mobile la tastiera virtuale riduce solo il visual viewport.
    const vv = window.visualViewport;
    const visibleBottom = vv ? Math.min(vv.offsetTop + vv.height, viewportH) : viewportH;
    const spaceBelow = visibleBottom - rect.bottom - GAP - VIEWPORT_MARGIN;
    const spaceAbove = rect.top - GAP - VIEWPORT_MARGIN;
    const placeBelow = spaceBelow >= Math.min(POPOVER_MAX_HEIGHT, 240) || spaceBelow >= spaceAbove;
    const width = Math.min(Math.max(rect.width, POPOVER_MIN_WIDTH), viewportW - VIEWPORT_MARGIN * 2);
    const left = Math.min(Math.max(rect.left, VIEWPORT_MARGIN), viewportW - VIEWPORT_MARGIN - width);
    const maxHeight = Math.max(Math.min(POPOVER_MAX_HEIGHT, placeBelow ? spaceBelow : spaceAbove), 120);
    setPopoverStyle(
      placeBelow
        ? { top: rect.bottom + GAP, left, width, maxHeight }
        : { bottom: viewportH - rect.top + GAP, left, width, maxHeight },
    );
  }, []);

  useLayoutEffect(() => {
    if (open) updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus({ preventScroll: true });

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (labelRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", updatePosition);
    window.visualViewport?.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", updatePosition);
      window.visualViewport?.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  // Se il campo viene disabilitato con il popover aperto, lo chiude.
  useEffect(() => {
    if (isDisabled) setOpen(false);
  }, [isDisabled]);

  // Mantiene visibile l'opzione evidenziata.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${highlight}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [open, highlight]);

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) openPopover();
    }
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (options.length > 0) setHighlight((h) => (h + 1) % options.length);
        break;
      case "ArrowUp":
        event.preventDefault();
        if (options.length > 0) setHighlight((h) => (h - 1 + options.length) % options.length);
        break;
      case "Home":
        event.preventDefault();
        setHighlight(0);
        break;
      case "End":
        event.preventDefault();
        setHighlight(Math.max(options.length - 1, 0));
        break;
      case "Enter": {
        event.preventDefault();
        const option = options[highlight];
        if (option) select(option);
        break;
      }
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        close(true);
        break;
      case "Tab":
        close(false);
        break;
    }
  }

  const activeOption = open && options[highlight] ? optionId(highlight) : undefined;

  return (
    <label ref={labelRef}>
      {t.assignee.label}
      <button
        ref={triggerRef}
        type="button"
        className="assignee-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        disabled={isDisabled}
        title={error ? t.assignee.loadError : undefined}
        onClick={() => (open ? close(false) : openPopover())}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className={`assignee-select-value${value ? "" : " is-placeholder"}`}>{triggerText}</span>
        <ChevronDownIcon className="assignee-select-chevron" />
      </button>
      {open &&
        createPortal(
          <div
            ref={popoverRef}
            className="assignee-select-popover"
            style={popoverStyle}
          >
            <input
              ref={inputRef}
              className="assignee-select-search"
              type="text"
              value={query}
              placeholder={t.assignee.searchPlaceholder}
              aria-label={t.assignee.searchPlaceholder}
              aria-controls={listboxId}
              aria-activedescendant={activeOption}
              aria-autocomplete="list"
              role="combobox"
              aria-expanded="true"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => {
                setQuery(e.target.value);
                setHighlight(0);
              }}
              onKeyDown={handleSearchKeyDown}
            />
            <ul ref={listRef} id={listboxId} role="listbox" aria-label={t.assignee.label} className="assignee-select-list">
              {options.map((option, index) => {
                const selected = option.id === value;
                return (
                  <li
                    key={option.id ?? "__unassigned"}
                    id={optionId(index)}
                    data-index={index}
                    role="option"
                    aria-selected={selected}
                    className={`assignee-select-option${index === highlight ? " is-active" : ""}${
                      option.id === null ? " is-unassigned" : ""
                    }`}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseMove={() => {
                      if (index !== highlight) setHighlight(index);
                    }}
                    onClick={() => select(option)}
                  >
                    <span className="assignee-select-option-name">{option.name}</span>
                    {selected && <CheckIcon className="assignee-select-check" />}
                  </li>
                );
              })}
            </ul>
            {options.length === 0 && <div className="assignee-select-empty">{t.assignee.noResults}</div>}
          </div>,
          document.body,
        )}
    </label>
  );
}
