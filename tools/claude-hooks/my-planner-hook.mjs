#!/usr/bin/env node
/**
 * Hook di Claude Code per la vista "In corso" di My Planner.
 *
 * Segnala lo stato della sessione (SessionStart, UserPromptSubmit,
 * PostToolUse, Notification, Stop, SessionEnd) a POST /hooks/claude-session.
 * Manda solo metadati: id sessione, evento, repository, branch, nome della
 * cartella e il testo della notifica. Mai prompt, transcript o codice.
 *
 * Regole:
 *  - non stampa NIENTE: per SessionStart e UserPromptSubmit l'output di un
 *    hook finisce nel contesto di Claude (consumerebbe token);
 *  - esce sempre con codice 0 e con timeout brevi: non deve mai bloccare
 *    o rallentare Claude, neanche se My Planner non risponde;
 *  - PostToolUse e' solo un segnale di vita: al massimo uno ogni 2 minuti.
 *
 * Configurazione (variabili d'ambiente; se mancano lo script non fa nulla):
 *  MY_PLANNER_URL         base della REST API (es. https://planner.example.com)
 *  MY_PLANNER_HOOK_TOKEN  token hook (mph_...) creato dal profilo di My Planner
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

const HEARTBEAT_MS = 2 * 60 * 1000;
const EVENTS = new Set(["SessionStart", "UserPromptSubmit", "PostToolUse", "Notification", "Stop", "SessionEnd"]);

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

function git(cwd, args) {
  try {
    return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", timeout: 1000, stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

/** true se e' passato abbastanza dall'ultimo invio (solo per PostToolUse). */
function heartbeatDue(sessionId, event) {
  const file = join(tmpdir(), `my-planner-hook-${createHash("sha256").update(sessionId).digest("hex").slice(0, 16)}`);
  const now = Date.now();
  if (event === "PostToolUse") {
    try {
      if (now - Number(readFileSync(file, "utf8")) < HEARTBEAT_MS) return false;
    } catch {
      /* primo invio */
    }
  }
  try {
    writeFileSync(file, String(now));
  } catch {
    /* best effort */
  }
  return true;
}

/** Link alla sessione cloud su claude.ai (best effort, da variabile non documentata). */
function cloudSessionUrl() {
  const match = /^cse_([A-Za-z0-9]+)$/.exec(process.env.CLAUDE_CODE_REMOTE_SESSION_ID ?? "");
  return match ? `https://claude.ai/code/session_${match[1]}` : null;
}

async function main() {
  const base = process.env.MY_PLANNER_URL?.replace(/\/+$/, "");
  const token = process.env.MY_PLANNER_HOOK_TOKEN;
  if (!base || !token) return;

  const input = readStdin();
  const event = input.hook_event_name;
  const sessionId = input.session_id;
  if (!EVENTS.has(event) || typeof sessionId !== "string" || !sessionId) return;
  if (!heartbeatDue(sessionId, event)) return;

  const cwd = typeof input.cwd === "string" && input.cwd ? input.cwd : process.cwd();
  const cloud = process.env.CLAUDE_CODE_REMOTE === "true";
  const body = {
    event,
    sessionId,
    origin: cloud ? "cloud" : "cli",
    url: cloud ? cloudSessionUrl() : null,
    repo: git(cwd, ["remote", "get-url", "origin"]),
    branch: git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]),
    workdir: basename(cwd).slice(0, 120) || null,
    message: event === "Notification" && typeof input.message === "string" ? input.message.slice(0, 300) : null,
  };

  await fetch(`${base}/hooks/claude-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(2500),
  });
}

main()
  .catch(() => undefined)
  .finally(() => process.exit(0));
