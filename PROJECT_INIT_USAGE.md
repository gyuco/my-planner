# PROJECT_INIT_PROMPT — come si usa

`PROJECT_INIT_PROMPT.md` è un prompt **generico e indipendente da questo progetto**:
vive qui solo per comodità, ma è pensato per essere usato su qualsiasi repo, con
qualsiasi CLI AI (Claude Code, Aider, Cursor CLI, Codex CLI, …).

Non contiene riferimenti a stack, convenzioni o file di questo progetto, e non
va adattato prima dell'uso: è il prompt stesso a rilevare la situazione del repo
su cui viene eseguito.

## Prerequisiti

- Il repo di destinazione ha `git init` e un remote configurato — il flusso
  branch / PR / merge lo presuppone.
- Il tracker esterno (Linear, GitHub Projects, Jira, …) è già collegato via MCP
  e autenticato: il prompt non crea board interne, quindi senza MCP lo Step 4d
  non può completarsi.
- Opzionali ma consigliati: `rtk` per il risparmio di token, e un code indexer
  (codegraph / tgrep o equivalente) per le query strutturali sul codice.

## Uso

1. Apri il tuo CLI AI nella cartella del progetto di destinazione — **non qui**.
2. Incolla il contenuto integrale di `PROJECT_INIT_PROMPT.md` come primo
   messaggio, senza aggiungere altro: il prompt guida lui la conversazione.
3. Rispondi allo Step 0 (5 domande in blocco), poi prosegui step per step.
4. Allo Step 5 ricevi il manifest completo dei file: dai il via libera unico e
   committa quanto generato.

Al termine il progetto di destinazione avrà `AGENTS.md`, `prd.md`,
`docs/architecture.md`, `docs/workflow.md`, i ruoli, le skill di base e il
backlog popolato sul tracker esterno.

## Dopo

Il prompt si esegue **una volta sola** per progetto. Da lì in poi il lavoro
segue il `docs/workflow.md` che il prompt stesso ha generato nel progetto di
destinazione.

Rilanciarlo su un progetto già inizializzato è sicuro: lo Step 1a lo rileva e
propone un aggiornamento incrementale a diff, senza sovrascrivere le skill
accumulate.
