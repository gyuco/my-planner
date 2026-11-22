import type { Locale } from "../i18n/config";

/**
 * Contenuto della pagina "Guida AI" (/guide): come configurare My Planner e
 * Claude per i task gestiti da AI. Segnaposti sostituiti a runtime:
 *   {globalUrl}  URL del connector MCP globale
 *   {appUrl}     URL dell'app
 * Nel testo, `codice` diventa <code> e **testo** diventa <strong>.
 */

export interface GuideSection {
  id: string;
  title: string;
  paragraphs?: string[];
  steps?: string[];
  bullets?: string[];
  tip?: string;
}

export interface GuideContent {
  title: string;
  intro: string;
  requirements: string;
  sections: GuideSection[];
}

const it: GuideContent = {
  title: "Guida: task gestiti da AI",
  intro:
    "My Planner può far lavorare Claude sui task: analisi (triage), sviluppo (coder) e revisione (reviewer). Questa guida spiega cosa configurare in My Planner e in Claude, una volta sola, e come usare la funzionalità ogni giorno.",
  requirements:
    "Ti servono: un account **admin** in My Planner, un abbonamento Claude con **Claude Code** (nessuna API a pagamento) e, per coder e reviewer, il **repository GitHub** del progetto con l'app GitHub di Claude installata.",
  sections: [
    {
      id: "how",
      title: "1. Come funziona",
      bullets: [
        "**Triage** lavora i task in **Draft**: li analizza, arricchisce la descrizione (obiettivo, file coinvolti, criteri di accettazione, priorità, complessità) e li sposta in **TODO**.",
        "**Coder** lavora i task in **TODO**: implementa su un branch `claude/<taskId>`, esegue i test, apre una pull request e sposta il task in **Testing**.",
        "**Reviewer** lavora i task in **Testing**: rivede la pull request e sposta il task in **Done**, oppure lo rimanda in **TODO** con le modifiche richieste (al massimo 3 volte, poi si ferma).",
        "Le colonne le sposta **il server**, non l'agente. Sulla card vedi il badge **AI** con il passo in attesa, in corso (giallo) o fermato (rosso).",
        "Se un passo non si può completare, il task resta dov'è con il motivo e il pulsante **Riprendi** nella scheda.",
        "Gli avvisi (push, campanella, email) arrivano **alla fine** del percorso o **a ogni cambio di stato**, come scegli nel task.",
      ],
    },
    {
      id: "planner",
      title: "2. Prepara My Planner (una volta)",
      steps: [
        "Apri **Impostazioni del progetto** (icona ingranaggio accanto al nome nella sidebar) e compila **Repository GitHub** (accetta anche `owner/repo`). Salva.",
        "Vai su **Profilo → Notifiche push** e premi **Attiva su questo dispositivo**, poi **Invia notifica di prova**. Ripeti su ogni dispositivo dove vuoi gli avvisi.",
      ],
      tip: "Su iPhone e iPad le push funzionano solo dall'app installata: in Safari tocca **Condividi → Aggiungi alla schermata Home**, apri My Planner dall'icona e attiva le notifiche da lì.",
    },
    {
      id: "connector",
      title: "3. Collega Claude a My Planner (connector globale)",
      paragraphs: [
        "Il connector globale dà a Claude accesso a tutti i tuoi progetti. Non serve copiare token: il permesso si concede accedendo con email e password di My Planner.",
      ],
      steps: [
        "Su **claude.ai** apri **Impostazioni → Connectors → Add custom connector**.",
        "Nome: `My Planner`. URL: `{globalUrl}`.",
        "Lascia **Sign in now** e **Register automatically**, senza header aggiuntivi, e conferma.",
        "Premi **Connetti**: si apre la pagina di My Planner, accedi con email e password.",
        "Controlla in **Profilo → MCP globale** che la connessione `claude.ai` mostri un orario di ultimo uso.",
      ],
      tip: "Per **Claude Code** in locale: `claude mcp add --transport http my-planner {globalUrl}`, poi `/mcp` e completa il login nel browser.",
    },
    {
      id: "routine",
      title: "4. Avvio automatico con una routine di Claude Code",
      paragraphs: [
        "Con la routine, appena un task ha un passo AI in attesa My Planner avvia da solo una sessione Claude nel cloud, sul tuo abbonamento. Serve una routine per ogni progetto.",
      ],
      steps: [
        "In My Planner: **Impostazioni del progetto → Avvio automatico AI → Copia prompt**.",
        "Su **claude.ai/code/routines** crea una nuova routine: nome a piacere, incolla il prompt come istruzioni, scegli il **repository** del progetto e l'ambiente cloud **Default**.",
        "**Trigger**: scegli **API** (non serve un orario). Se in creazione c'è solo lo schedule, lo cambi dopo.",
        "**Advanced settings → Connectors**: lascia solo **My Planner**.",
        "Crea la routine, poi aprila: **Add another trigger → API → Generate token**. Copia il **token** (`sk-ant-oat01-…`, si vede una sola volta) e l'**ID** della routine (`trig_…`, è nell'URL del trigger).",
        "Torna nelle impostazioni del progetto, incolla **ID** e **token** e premi **Salva routine**: lo stato diventa **Attivo**.",
      ],
      tip: "Il token è salvato cifrato e non viene mai mostrato di nuovo. Se lo rigeneri in Claude, il vecchio smette di funzionare: incolla quello nuovo e salva.",
    },
    {
      id: "use",
      title: "5. Usa la funzionalità",
      steps: [
        "Apri un task (da admin) e nella sezione **Gestione AI** attiva **Gestisci con un modello AI**.",
        "Scegli i **passi** (uno, due o tutti e tre) e quando essere **avvisato**, poi **Salva gestione AI**.",
        "Se la routine è configurata parte da sola: nella scheda compare il link **Sessione Claude** e sulla card il badge **in corso**.",
        "Quando il passo è chiuso il task cambia colonna, trovi un commento 🤖 con il riepilogo e ti arriva l'avviso.",
      ],
      tip: "Senza routine puoi lavorare la coda a mano: in Claude Code scegli il comando `work_ai_queue` del connector My Planner dal menu `/`, oppure scrivi a Claude «lavora la coda AI di My Planner».",
    },
    {
      id: "troubleshooting",
      title: "6. Problemi comuni",
      bullets: [
        "**La routine non parte**: in Impostazioni del progetto controlla **Ultimo errore**, poi prova **Avvia coda AI** in alto a destra sulla board. Lo stesso passo non viene riavviato prima di 30 minuti.",
        "**Token del trigger rifiutato**: rigenera il token nella routine e salvalo di nuovo in My Planner. **Routine non trovata**: controlla l'ID `trig_…`.",
        "**Limite di avvii raggiunto**: massimo 30 avvii all'ora per routine; aspetta e riprova.",
        "**Task con badge «fermata»**: leggi il motivo nella scheda, aggiungi le informazioni mancanti e premi **Riprendi** (oppure sposta il task a mano).",
        "**Il connector non si collega**: rimuovilo da Claude e aggiungilo di nuovo; in Profilo puoi revocare le connessioni rimaste «mai usate».",
        "**Le push non arrivano**: Profilo → Notifiche push → **Invia notifica di prova**; su iPhone usa l'app aperta dalla schermata Home.",
        "**Claude non vede i tool AI**: apri una sessione nuova, le sessioni già aperte non ricaricano i tool.",
      ],
    },
  ],
};

const en: GuideContent = {
  title: "Guide: AI-handled tasks",
  intro:
    "My Planner can have Claude work on tasks: analysis (triage), development (coder) and review (reviewer). This guide explains what to set up once in My Planner and in Claude, and how to use the feature day to day.",
  requirements:
    "You need: an **admin** account in My Planner, a Claude subscription with **Claude Code** (no paid API) and, for coder and reviewer, the project's **GitHub repository** with Claude's GitHub app installed.",
  sections: [
    {
      id: "how",
      title: "1. How it works",
      bullets: [
        "**Triage** works tasks in **Draft**: it analyzes them, enriches the description (goal, files involved, acceptance criteria, priority, complexity) and moves them to **TODO**.",
        "**Coder** works tasks in **TODO**: it implements on a `claude/<taskId>` branch, runs the tests, opens a pull request and moves the task to **Testing**.",
        "**Reviewer** works tasks in **Testing**: it reviews the pull request and moves the task to **Done**, or sends it back to **TODO** with the requested changes (at most 3 times, then it stops).",
        "**The server** moves the columns, not the agent. On the card the **AI** badge shows the step waiting, running (yellow) or stopped (red).",
        "If a step can't be completed, the task stays where it is with the reason and a **Resume** button in the task.",
        "Alerts (push, bell, email) arrive **at the end** of the path or **on every status change**, as chosen in the task.",
      ],
    },
    {
      id: "planner",
      title: "2. Set up My Planner (once)",
      steps: [
        "Open **Project settings** (gear icon next to the name in the sidebar) and fill in **GitHub repository** (`owner/repo` works too). Save.",
        "Go to **Profile → Push notifications**, press **Enable on this device**, then **Send test notification**. Repeat on every device where you want alerts.",
      ],
      tip: "On iPhone and iPad push only works from the installed app: in Safari tap **Share → Add to Home Screen**, open My Planner from the icon and enable notifications there.",
    },
    {
      id: "connector",
      title: "3. Connect Claude to My Planner (global connector)",
      paragraphs: [
        "The global connector gives Claude access to all your projects. No token to copy: you grant access by signing in with your My Planner email and password.",
      ],
      steps: [
        "On **claude.ai** open **Settings → Connectors → Add custom connector**.",
        "Name: `My Planner`. URL: `{globalUrl}`.",
        "Keep **Sign in now** and **Register automatically**, no extra headers, and confirm.",
        "Press **Connect**: the My Planner page opens, sign in with email and password.",
        "Check in **Profile → Global MCP** that the `claude.ai` connection shows a last-used time.",
      ],
      tip: "For local **Claude Code**: `claude mcp add --transport http my-planner {globalUrl}`, then `/mcp` and complete the login in the browser.",
    },
    {
      id: "routine",
      title: "4. Automatic start with a Claude Code routine",
      paragraphs: [
        "With a routine, as soon as a task has an AI step waiting My Planner starts a Claude session in the cloud by itself, on your subscription. You need one routine per project.",
      ],
      steps: [
        "In My Planner: **Project settings → Automatic AI start → Copy prompt**.",
        "On **claude.ai/code/routines** create a new routine: any name, paste the prompt as instructions, pick the project's **repository** and the **Default** cloud environment.",
        "**Trigger**: choose **API** (no schedule needed). If only a schedule is offered while creating, change it afterwards.",
        "**Advanced settings → Connectors**: keep only **My Planner**.",
        "Create the routine, then open it: **Add another trigger → API → Generate token**. Copy the **token** (`sk-ant-oat01-…`, shown only once) and the routine **ID** (`trig_…`, it's in the trigger URL).",
        "Back in the project settings, paste **ID** and **token** and press **Save routine**: the status becomes **Active**.",
      ],
      tip: "The token is stored encrypted and never shown again. If you regenerate it in Claude, the old one stops working: paste the new one and save.",
    },
    {
      id: "use",
      title: "5. Use the feature",
      steps: [
        "Open a task (as admin) and in the **AI handling** section turn on **Handle with an AI model**.",
        "Pick the **steps** (one, two or all three) and when to be **notified**, then **Save AI handling**.",
        "If the routine is set up it starts by itself: the task shows a **Claude session** link and the card a **running** badge.",
        "When the step is done the task changes column, you'll find a 🤖 comment with the summary and you get the alert.",
      ],
      tip: "Without a routine you can work the queue by hand: in Claude Code pick the My Planner connector's `work_ai_queue` command from the `/` menu, or tell Claude “work the My Planner AI queue”.",
    },
    {
      id: "troubleshooting",
      title: "6. Troubleshooting",
      bullets: [
        "**The routine doesn't start**: in Project settings check **Last error**, then try **Start AI queue** at the top right of the board. The same step isn't restarted within 30 minutes.",
        "**Trigger token rejected**: regenerate the token in the routine and save it again in My Planner. **Routine not found**: check the `trig_…` ID.",
        "**Start limit reached**: at most 30 starts per hour per routine; wait and retry.",
        "**Task with a “stopped” badge**: read the reason in the task, add the missing information and press **Resume** (or move the task by hand).",
        "**The connector won't connect**: remove it from Claude and add it again; in Profile you can revoke connections left “never used”.",
        "**Push doesn't arrive**: Profile → Push notifications → **Send test notification**; on iPhone use the app opened from the Home Screen.",
        "**Claude doesn't see the AI tools**: open a new session, already open sessions don't reload tools.",
      ],
    },
  ],
};

const es: GuideContent = {
  title: "Guía: tareas gestionadas por IA",
  intro:
    "My Planner puede hacer que Claude trabaje en las tareas: análisis (triage), desarrollo (coder) y revisión (reviewer). Esta guía explica qué configurar una sola vez en My Planner y en Claude, y cómo usar la función en el día a día.",
  requirements:
    "Necesitas: una cuenta **admin** en My Planner, una suscripción de Claude con **Claude Code** (sin API de pago) y, para coder y reviewer, el **repositorio GitHub** del proyecto con la app de GitHub de Claude instalada.",
  sections: [
    {
      id: "how",
      title: "1. Cómo funciona",
      bullets: [
        "**Triage** trabaja las tareas en **Draft**: las analiza, enriquece la descripción (objetivo, archivos implicados, criterios de aceptación, prioridad, complejidad) y las mueve a **TODO**.",
        "**Coder** trabaja las tareas en **TODO**: implementa en una rama `claude/<taskId>`, ejecuta los tests, abre una pull request y mueve la tarea a **Testing**.",
        "**Reviewer** trabaja las tareas en **Testing**: revisa la pull request y mueve la tarea a **Done**, o la devuelve a **TODO** con los cambios pedidos (como máximo 3 veces, luego se detiene).",
        "Las columnas las mueve **el servidor**, no el agente. En la tarjeta el distintivo **IA** muestra el paso pendiente, en curso (amarillo) o detenido (rojo).",
        "Si un paso no se puede completar, la tarea se queda donde está con el motivo y el botón **Reanudar** en la ficha.",
        "Los avisos (push, campana, email) llegan **al final** del recorrido o **en cada cambio de estado**, según lo elegido en la tarea.",
      ],
    },
    {
      id: "planner",
      title: "2. Prepara My Planner (una vez)",
      steps: [
        "Abre **Ajustes del proyecto** (icono de engranaje junto al nombre en la barra lateral) y rellena **Repositorio GitHub** (también acepta `owner/repo`). Guarda.",
        "Ve a **Perfil → Notificaciones push**, pulsa **Activar en este dispositivo** y luego **Enviar notificación de prueba**. Repite en cada dispositivo donde quieras los avisos.",
      ],
      tip: "En iPhone y iPad las push solo funcionan desde la app instalada: en Safari toca **Compartir → Añadir a pantalla de inicio**, abre My Planner desde el icono y activa las notificaciones allí.",
    },
    {
      id: "connector",
      title: "3. Conecta Claude con My Planner (conector global)",
      paragraphs: [
        "El conector global da a Claude acceso a todos tus proyectos. No hay que copiar tokens: el permiso se concede iniciando sesión con el email y la contraseña de My Planner.",
      ],
      steps: [
        "En **claude.ai** abre **Ajustes → Connectors → Add custom connector**.",
        "Nombre: `My Planner`. URL: `{globalUrl}`.",
        "Deja **Sign in now** y **Register automatically**, sin cabeceras adicionales, y confirma.",
        "Pulsa **Conectar**: se abre la página de My Planner, inicia sesión con email y contraseña.",
        "Comprueba en **Perfil → MCP global** que la conexión `claude.ai` muestra una hora de último uso.",
      ],
      tip: "Para **Claude Code** en local: `claude mcp add --transport http my-planner {globalUrl}`, luego `/mcp` y completa el inicio de sesión en el navegador.",
    },
    {
      id: "routine",
      title: "4. Inicio automático con una rutina de Claude Code",
      paragraphs: [
        "Con la rutina, en cuanto una tarea tiene un paso de IA pendiente, My Planner inicia sola una sesión de Claude en la nube, con tu suscripción. Hace falta una rutina por proyecto.",
      ],
      steps: [
        "En My Planner: **Ajustes del proyecto → Inicio automático IA → Copiar prompt**.",
        "En **claude.ai/code/routines** crea una nueva rutina: nombre a elección, pega el prompt como instrucciones, elige el **repositorio** del proyecto y el entorno en la nube **Default**.",
        "**Trigger**: elige **API** (no hace falta horario). Si al crearla solo aparece el schedule, lo cambias después.",
        "**Advanced settings → Connectors**: deja solo **My Planner**.",
        "Crea la rutina y ábrela: **Add another trigger → API → Generate token**. Copia el **token** (`sk-ant-oat01-…`, se muestra una sola vez) y el **ID** de la rutina (`trig_…`, está en la URL del trigger).",
        "Vuelve a los ajustes del proyecto, pega **ID** y **token** y pulsa **Guardar rutina**: el estado pasa a **Activo**.",
      ],
      tip: "El token se guarda cifrado y no se vuelve a mostrar. Si lo regeneras en Claude, el anterior deja de funcionar: pega el nuevo y guarda.",
    },
    {
      id: "use",
      title: "5. Usa la función",
      steps: [
        "Abre una tarea (como admin) y en la sección **Gestión IA** activa **Gestionar con un modelo de IA**.",
        "Elige los **pasos** (uno, dos o los tres) y cuándo recibir **avisos**, luego **Guardar gestión IA**.",
        "Si la rutina está configurada arranca sola: la ficha muestra el enlace **Sesión de Claude** y la tarjeta el distintivo **en curso**.",
        "Cuando el paso termina la tarea cambia de columna, encontrarás un comentario 🤖 con el resumen y recibirás el aviso.",
      ],
      tip: "Sin rutina puedes trabajar la cola a mano: en Claude Code elige el comando `work_ai_queue` del conector My Planner en el menú `/`, o pide a Claude «trabaja la cola IA de My Planner».",
    },
    {
      id: "troubleshooting",
      title: "6. Problemas comunes",
      bullets: [
        "**La rutina no arranca**: en Ajustes del proyecto revisa **Último error** y prueba **Iniciar cola IA** arriba a la derecha del tablero. El mismo paso no se reinicia antes de 30 minutos.",
        "**Token del trigger rechazado**: regenera el token en la rutina y guárdalo de nuevo en My Planner. **Rutina no encontrada**: revisa el ID `trig_…`.",
        "**Límite de inicios alcanzado**: máximo 30 inicios por hora por rutina; espera y vuelve a intentarlo.",
        "**Tarea con distintivo «detenida»**: lee el motivo en la ficha, añade la información que falta y pulsa **Reanudar** (o mueve la tarea a mano).",
        "**El conector no se conecta**: quítalo de Claude y vuelve a añadirlo; en Perfil puedes revocar las conexiones «nunca usadas».",
        "**No llegan las push**: Perfil → Notificaciones push → **Enviar notificación de prueba**; en iPhone usa la app abierta desde la pantalla de inicio.",
        "**Claude no ve las herramientas de IA**: abre una sesión nueva, las sesiones ya abiertas no recargan las herramientas.",
      ],
    },
  ],
};

const GUIDES: Record<Locale, GuideContent> = { it, en, es };

export function aiGuide(locale: Locale): GuideContent {
  return GUIDES[locale] ?? en;
}
