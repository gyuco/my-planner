# Workflow degli agenti — my-planner

Ogni feature/batch di lavoro passa attraverso queste fasi, in ordine. Non si salta una fase.

1. **analyst + architect** — fase di analisi.
   `analyst` raffina i requisiti dal PRD e da eventuali richieste nuove; `architect` prende le decisioni tecniche (schema DB, contratti API/MCP) necessarie prima che il lavoro possa essere scomposto in task. Se emergono ambiguità che cambiano la scomposizione, si fermano e chiedono — non assumono.

2. **planner** — crea il backlog.
   Legge PRD + output di analyst/architect, scompone il lavoro in task con priorità, complessità Fibonacci, subtask e dipendenze. Aggiorna `BACKLOG.md`. Anche qui: dubbio bloccante → domanda esplicita, non assunzione.

3. **coder** — implementa.
   Realizza i task assegnati seguendo `API_CONTRACT.md` e le decisioni di `architect`, riusando sempre il service layer condiviso tra REST e MCP.

4. **reviewer** — verifica.
   Ogni batch implementato da `coder` passa da `reviewer` **prima** di essere considerato chiuso: correttezza logica, sicurezza (JWT/token MCP/scoping tra progetti), coerenza col PRD, duplicazioni REST/MCP da accorpare nel service layer. I problemi trovati tornano a `coder` per il fix, poi si ripete la review se il fix è sostanziale.

Nessun batch di `coder` si considera "fatto" solo perché typecheck/build passano o perché un test manuale ad-hoc ha funzionato: serve il passaggio da `reviewer`.
