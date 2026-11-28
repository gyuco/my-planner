import { describe, expect, it } from "vitest";
import type { AiBinding } from "../lib/workersAi.js";
import { SUMMARY_MODEL } from "../services/semanticService.js";
import { renderStandupHtml, renderStandupText, summarizeStandup, type StandupReport } from "./standup.js";

/** Riassunto dello standup con Workers AI (binding simulato). */

const report: StandupReport = {
  yesterdayIso: "2026-11-27",
  todayLabel: "sabato 28 novembre 2026",
  yesterdayLabel: "venerdì 27 novembre",
  projects: [
    {
      name: "Clinica",
      done: [{ title: "Login <rapido>", priority: "high", dueDate: null, idleDays: 0 }],
      inProgress: [{ title: "Export PDF", priority: "medium", dueDate: null, idleDays: 4 }],
      todo: [{ title: "Notifiche", priority: "urgent", dueDate: new Date("2026-11-30T10:00:00Z"), idleDays: 1 }],
    },
  ],
  totals: { done: 1, inProgress: 1, todo: 1 },
};

describe("summarizeStandup", () => {
  it("chiede il riassunto al modello con i dati compatti e pulisce il markdown", async () => {
    const calls: { model: string; input: Record<string, unknown> }[] = [];
    const ai: AiBinding = {
      async run(model, input) {
        calls.push({ model, input });
        return { response: "**Ieri** chiuso il login. Oggi le notifiche urgenti." };
      },
    };
    const summary = await summarizeStandup(report, ai);
    expect(summary).toBe("Ieri chiuso il login. Oggi le notifiche urgenti.");
    expect(calls[0].model).toBe(SUMMARY_MODEL);
    const messages = calls[0].input.messages as { role: string; content: string }[];
    const data = JSON.parse(messages[1].content);
    expect(data.projects[0].toDo.tasks[0]).toEqual({ title: "Notifiche", priority: "urgent", due: "2026-11-30" });
    expect(data.projects[0].inProgress.tasks[0].idleDays).toBe(4);
  });

  it("best-effort: null senza binding, senza attivita' o se il modello fallisce", async () => {
    expect(await summarizeStandup(report, null)).toBeNull();
    const failing: AiBinding = { run: async () => { throw new Error("4006: daily free allocation exceeded"); } };
    expect(await summarizeStandup(report, failing)).toBeNull();
    const never: AiBinding = { run: async () => { throw new Error("non deve essere chiamato"); } };
    expect(await summarizeStandup({ ...report, projects: [] }, never)).toBeNull();
  });
});

describe("rendering con riassunto", () => {
  it("il riassunto precede il dettaglio, testo e HTML (con escape)", () => {
    const summary = "Ieri chiuso <b>login</b>.";
    const text = renderStandupText(report, summary);
    expect(text.indexOf(summary)).toBeLessThan(text.indexOf("== Clinica =="));
    expect(text).toContain("--- Dettaglio ---");

    const html = renderStandupHtml(report, summary);
    expect(html).toContain("Ieri chiuso &lt;b&gt;login&lt;/b&gt;.");
    expect(html.indexOf("Ieri chiuso")).toBeLessThan(html.indexOf("Dettaglio"));
    expect(html).toContain("Login &lt;rapido&gt;");
  });

  it("senza riassunto la mail resta quella di prima", () => {
    expect(renderStandupText(report)).not.toContain("Dettaglio");
    expect(renderStandupHtml(report)).not.toContain("Dettaglio");
  });
});
