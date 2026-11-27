import type { VoiceSession } from "@my-planner/core";
import { PcmPlayer, startMicCapture, type MicCapture } from "./audio";
import {
  VOICE_FUNCTION_DECLARATIONS,
  buildSystemInstruction,
  executeVoiceTool,
  isMutatingTool,
  type VoiceToolHost,
} from "./tools";

/**
 * Conversazione con Gemini Live via WebSocket (protocollo BidiGenerateContent,
 * senza SDK). Il browser:
 *  - manda l'audio del microfono come `realtimeInput.audio`;
 *  - riproduce l'audio di `serverContent.modelTurn` e lo interrompe su
 *    `serverContent.interrupted` (l'utente ha parlato sopra);
 *  - esegue i `toolCall` con le API REST e risponde con `toolResponse`.
 */

export type VoicePhase = "connecting" | "listening" | "speaking" | "working" | "closed" | "error";

export interface TranscriptEntry {
  id: number;
  role: "user" | "assistant" | "action";
  text: string;
  /** Azione: esito (true = ok). */
  ok?: boolean;
}

export interface LiveSessionCallbacks {
  onPhase: (phase: VoicePhase, error?: string) => void;
  onTranscript: (entries: TranscriptEntry[]) => void;
  onLevel?: (level: number) => void;
  /** Microfono attivo/disattivato (o non disponibile: permesso negato, assente). */
  onMic?: (state: MicState) => void;
}

export type MicState = "on" | "muted" | "unavailable";

export interface LiveSessionOptions {
  /** Chiusura automatica dopo questo silenzio (default 90 s). */
  idleTimeoutMs?: number;
  /** Parte con il microfono spento (es. conversazione iniziata scrivendo). */
  startMuted?: boolean;
}

interface FunctionCall {
  id: string;
  name: string;
  args?: Record<string, unknown>;
}

/** Chiusura automatica se nessuno parla per questo tempo (costi). */
const DEFAULT_IDLE_TIMEOUT_MS = 90_000;

export class LiveVoiceSession {
  private ws: WebSocket | null = null;
  private mic: MicCapture | null = null;
  private player = new PcmPlayer();
  private transcript: TranscriptEntry[] = [];
  private nextEntryId = 1;
  private cancelledCalls = new Set<string>();
  /** Risultati delle chiamate del turno corrente: 3.8 Live a volte ripete la stessa chiamata. */
  private turnResults = new Map<string, Promise<Record<string, unknown>>>();
  private pendingTools = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private phase: VoicePhase = "connecting";
  private speakingPoll: ReturnType<typeof setInterval> | null = null;

  private session: VoiceSession | null = null;
  private ready = false;
  private muted: boolean;
  /** Messaggi scritti prima che la sessione sia pronta. */
  private pendingTexts: string[] = [];

  constructor(
    private fetchSession: () => Promise<VoiceSession>,
    private host: VoiceToolHost,
    private language: string,
    private labels: { actionPrefix: (name: string) => string },
    private callbacks: LiveSessionCallbacks,
    private options: LiveSessionOptions = {},
  ) {
    this.muted = Boolean(options.startMuted);
  }

  /** Volume dell'audio del modello (0..1), per animare l'avatar. */
  outputLevel(): number {
    return this.player.level();
  }

  get micState(): MicState {
    return this.mic ? (this.muted ? "muted" : "on") : "unavailable";
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (!muted) this.touch();
    this.callbacks.onMic?.(this.micState);
  }

  /** Messaggio scritto: il modello risponde a voce come per il parlato. */
  sendText(text: string) {
    const clean = text.trim();
    if (!clean || this.closed) return;
    this.transcript = [...this.transcript, { id: this.nextEntryId++, role: "user", text: clean }];
    this.callbacks.onTranscript(this.transcript);
    this.touch();
    if (!this.ready) {
      this.pendingTexts.push(clean);
      return;
    }
    // L'utente interrompe l'eventuale risposta in corso, come parlando.
    this.player.flush();
    this.send({ realtimeInput: { text: clean } });
  }

  /** Da chiamare nel gesto dell'utente (click): sblocca l'audio su Safari/iOS. */
  async start() {
    this.setPhase("connecting");
    // resume() parte subito, ancora dentro il gesto dell'utente.
    const resumed = this.player.resume();

    try {
      // Microfono facoltativo: se manca o e' negato si continua scrivendo.
      try {
        this.mic = await startMicCapture(
          (chunk) => {
            if (!this.muted) this.send({ realtimeInput: { audio: { data: chunk, mimeType: "audio/pcm;rate=16000" } } });
          },
          (level) => this.callbacks.onLevel?.(this.muted ? 0 : level),
        );
      } catch (err) {
        if (!(err instanceof DOMException)) throw err;
        this.mic = null;
      }
      this.callbacks.onMic?.(this.micState);
      await resumed;
      if (this.closed) return this.mic?.stop();
      this.session = await this.fetchSession();
    } catch (err) {
      this.fail(err instanceof Error ? err.message : String(err));
      throw err;
    }
    if (this.closed) return;

    const ws = new WebSocket(this.session.wsUrl);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onopen = () => this.sendSetup();
    ws.onmessage = (e) => void this.handleMessage(e.data);
    ws.onerror = () => this.fail("connection");
    ws.onclose = (e) => {
      if (this.closed) return;
      // 1000 = chiusura normale (es. sessione scaduta): non e' un errore.
      if (e.code === 1000) this.stop();
      else this.fail(e.reason || `close ${e.code}`);
    };
    this.speakingPoll = setInterval(() => this.refreshPhase(), 250);
  }

  stop() {
    if (this.closed) return;
    this.closed = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.speakingPoll) clearInterval(this.speakingPoll);
    this.mic?.stop();
    this.player.close();
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) this.ws.close(1000);
    this.setPhase("closed");
  }

  private fail(reason: string) {
    if (this.closed) return;
    this.setPhase("error", reason);
    this.closed = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.speakingPoll) clearInterval(this.speakingPoll);
    this.mic?.stop();
    this.player.close();
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) this.ws.close();
  }

  private setPhase(phase: VoicePhase, error?: string) {
    if (this.phase === phase && !error) return;
    this.phase = phase;
    this.callbacks.onPhase(phase, error);
  }

  private refreshPhase() {
    if (this.closed || this.phase === "connecting") return;
    if (this.pendingTools > 0) this.setPhase("working");
    else this.setPhase(this.player.playing ? "speaking" : "listening");
  }

  private touch() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.stop(), this.options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS);
  }

  private send(message: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN && !this.closed) this.ws.send(JSON.stringify(message));
  }

  private sendSetup() {
    if (!this.session) return;
    const ctx = this.host.getContext();
    this.send({
      setup: {
        model: `models/${this.session.model}`,
        generationConfig: {
          responseModalities: ["AUDIO"],
          ...(this.session.voiceName
            ? { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: this.session.voiceName } } } }
            : {}),
        },
        systemInstruction: { parts: [{ text: buildSystemInstruction(this.language, ctx) }] },
        tools: [{ functionDeclarations: VOICE_FUNCTION_DECLARATIONS }],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
    });
  }

  /** Accoda testo alla voce corrente dello stesso ruolo (le trascrizioni arrivano a pezzi). */
  private appendTranscript(role: "user" | "assistant", text: string) {
    if (!text) return;
    const last = this.transcript[this.transcript.length - 1];
    if (last && last.role === role) {
      this.transcript = [...this.transcript.slice(0, -1), { ...last, text: last.text + text }];
    } else {
      this.transcript = [...this.transcript, { id: this.nextEntryId++, role, text: text.trimStart() }];
    }
    this.callbacks.onTranscript(this.transcript);
  }

  private pushAction(text: string, ok: boolean) {
    this.transcript = [...this.transcript, { id: this.nextEntryId++, role: "action", text, ok }];
    this.callbacks.onTranscript(this.transcript);
  }

  private async handleMessage(data: unknown) {
    let msg: any;
    try {
      const text = typeof data === "string" ? data : new TextDecoder().decode(data as ArrayBuffer);
      msg = JSON.parse(text);
    } catch {
      return;
    }

    if (msg.setupComplete) {
      this.ready = true;
      this.setPhase("listening");
      this.touch();
      for (const text of this.pendingTexts.splice(0)) this.send({ realtimeInput: { text } });
      return;
    }

    if (msg.serverContent) {
      const content = msg.serverContent;
      if (content.interrupted) this.player.flush();
      for (const part of content.modelTurn?.parts ?? []) {
        if (part.inlineData?.data && String(part.inlineData.mimeType ?? "").startsWith("audio/")) {
          this.player.enqueue(part.inlineData.data);
        }
      }
      if (content.inputTranscription?.text) {
        this.touch();
        this.appendTranscript("user", content.inputTranscription.text);
      }
      if (content.outputTranscription?.text) {
        this.touch();
        this.appendTranscript("assistant", content.outputTranscription.text);
      }
      if (content.turnComplete) this.turnResults.clear();
    }

    if (msg.toolCall?.functionCalls) {
      this.touch();
      await this.runTools(msg.toolCall.functionCalls as FunctionCall[]);
    }

    if (msg.toolCallCancellation?.ids) {
      for (const id of msg.toolCallCancellation.ids as string[]) this.cancelledCalls.add(id);
    }

    if (msg.goAway) {
      // Il server chiudera' a breve (limite di durata della sessione).
      this.stop();
    }
  }

  private async runTools(calls: FunctionCall[]) {
    this.pendingTools++;
    this.refreshPhase();
    const responses: { id: string; name: string; response: Record<string, unknown> }[] = [];
    try {
      for (const call of calls) {
        const args = call.args ?? {};
        const key = `${call.name}:${JSON.stringify(args)}`;
        // Si memorizza la promise (non il risultato): due toolCall identici
        // arrivati insieme producono una sola esecuzione.
        let pending = this.turnResults.get(key);
        if (!pending) {
          pending = executeVoiceTool(call.name, args, this.host).catch((err: unknown) => ({
            error: err instanceof Error ? err.message : String(err),
          }));
          this.turnResults.set(key, pending);
          if (isMutatingTool(call.name) && args.confirmed === true) {
            void pending.then((r) => this.pushAction(this.labels.actionPrefix(call.name), !r.error));
          }
        }
        const response = await pending;
        if (!this.cancelledCalls.has(call.id)) responses.push({ id: call.id, name: call.name, response });
      }
    } finally {
      this.pendingTools--;
      this.refreshPhase();
    }
    if (responses.length > 0) this.send({ toolResponse: { functionResponses: responses } });
  }
}
