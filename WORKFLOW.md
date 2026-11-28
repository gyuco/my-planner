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

## Branch e pull request

`main` è la produzione: ogni push su `main` fa partire il deploy su Cloudflare (vedi `.github/workflows/ci.yml`). Lo sviluppo passa sempre da `develop`, mai direttamente su `main`.

1. **Branch di lavoro da `develop`.** Ogni feature o fix parte da un branch creato da `develop` aggiornato (`git fetch origin develop && git checkout -b <branch> origin/develop`).
2. **PR verso `develop`.** Il lavoro finito si propone con una pull request con base `develop` e si unisce lì. Mai una PR da un branch di lavoro verso `main`.
3. **Release: PR da `develop` verso `main`.** Quando si vuole pubblicare, si apre una PR con head `develop` e base `main`. Unirla avvia il deploy in produzione.
4. **Riallineamento.** Se qualcosa finisce su `main` senza passare da `develop` (es. una PR aperta per errore verso `main`), si riallinea subito con una PR da `main` verso `develop`, così i due rami tornano ad avere lo stesso codice.

Prima di iniziare un nuovo lavoro su un branch già usato, se le sue PR sono state unite lo si riparte da `develop` aggiornato invece di continuare sulla storia vecchia.
