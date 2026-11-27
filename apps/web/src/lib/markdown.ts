import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({ breaks: true, gfm: true });

/** Elementi di blocco che chiudono il testo "in riga" di una voce di task list. */
const BLOCK_TAGS = new Set(["UL", "OL", "P", "DIV", "PRE", "BLOCKQUOTE", "TABLE", "H1", "H2", "H3", "H4", "H5", "H6", "HR"]);

/** Restituisce la checkbox GFM con cui inizia un <li> (direttamente o dentro il primo <p>), se c'e'. */
function leadingCheckbox(li: Element): HTMLInputElement | null {
  let first = li.firstElementChild;
  if (first?.tagName === "P") first = first.firstElementChild;
  if (first instanceof HTMLInputElement && first.type === "checkbox") return first;
  return null;
}

/**
 * Marca le task list GFM (`- [ ] voce`) con classi stile GitHub, cosi' il CSS
 * puo' stilarle senza :has: `contains-task-list` sulla lista, `task-list-item`
 * (+ `is-checked`) sul <li>, `task-list-checkbox` sull'input. Il testo in riga
 * dopo la checkbox viene avvolto in `.task-list-text`, cosi' l'attenuazione
 * delle voci spuntate non si propaga alle eventuali sottoliste.
 */
function markTaskLists(root: DocumentFragment): void {
  root.querySelectorAll("li").forEach((li) => {
    const checkbox = leadingCheckbox(li);
    if (!checkbox) return;
    li.classList.add("task-list-item");
    if (checkbox.checked) li.classList.add("is-checked");
    checkbox.classList.add("task-list-checkbox");
    li.parentElement?.classList.add("contains-task-list");

    const text = document.createElement("span");
    text.className = "task-list-text";
    let node = checkbox.nextSibling;
    while (node && !(node instanceof Element && BLOCK_TAGS.has(node.tagName))) {
      const next = node.nextSibling;
      text.appendChild(node);
      node = next;
    }
    if (text.firstChild && text.firstChild.nodeType === Node.TEXT_NODE) {
      text.firstChild.textContent = (text.firstChild.textContent ?? "").replace(/^\s+/, "");
    }
    checkbox.after(text);
  });
}

/** Converte markdown in HTML sanitizzato, pronto per dangerouslySetInnerHTML. */
export function renderMarkdown(source: string): string {
  const rawHtml = marked.parse(source, { async: false }) as string;
  const fragment = DOMPurify.sanitize(rawHtml, { RETURN_DOM_FRAGMENT: true });
  markTaskLists(fragment);
  const container = document.createElement("div");
  container.appendChild(fragment);
  return container.innerHTML;
}
