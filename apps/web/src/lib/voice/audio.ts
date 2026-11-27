/**
 * Audio per Gemini Live: il microfono va inviato come PCM 16 bit mono a
 * 16 kHz, la voce del modello arriva come PCM 16 bit mono a 24 kHz.
 *
 * La cattura usa un AudioWorklet alla frequenza nativa del dispositivo (un
 * AudioContext a 16 kHz collegato al microfono non funziona ovunque, es.
 * Firefox) e ricampiona a 16 kHz dentro il worklet.
 */

export const INPUT_SAMPLE_RATE = 16000;
export const OUTPUT_SAMPLE_RATE = 24000;

// Worklet inline (Blob URL): niente file statico separato da servire.
const CAPTURE_WORKLET = `
class PcmCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.ratio = sampleRate / options.processorOptions.targetRate;
    this.chunkSize = options.processorOptions.chunkSize;
    this.buffer = new Int16Array(this.chunkSize);
    this.length = 0;
    this.pos = 0;
    this.prev = 0;
  }
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    // Ricampionamento lineare dalla frequenza del contesto a quella richiesta.
    while (this.pos < input.length) {
      const i = Math.floor(this.pos);
      const frac = this.pos - i;
      const a = i === 0 ? this.prev : input[i - 1];
      const b = input[i];
      const s = Math.max(-1, Math.min(1, a + (b - a) * frac));
      this.buffer[this.length++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.length === this.chunkSize) {
        this.port.postMessage(this.buffer.buffer.slice(0));
        this.length = 0;
      }
      this.pos += this.ratio;
    }
    this.pos -= input.length;
    this.prev = input[input.length - 1];
    return true;
  }
}
registerProcessor("pcm-capture", PcmCapture);
`;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

function fromBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export interface MicCapture {
  stop: () => void;
}

/**
 * Avvia il microfono e chiama `onChunk` con blocchi PCM16 a 16 kHz in base64
 * (~100 ms ciascuno). `onLevel` riceve il volume (0..1) per l'indicatore.
 */
export async function startMicCapture(
  onChunk: (base64Pcm: string) => void,
  onLevel?: (level: number) => void,
): Promise<MicCapture> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const ctx = new AudioContext();
  const workletUrl = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: "application/javascript" }));
  try {
    await ctx.audioWorklet.addModule(workletUrl);
  } finally {
    URL.revokeObjectURL(workletUrl);
  }
  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "pcm-capture", {
    processorOptions: { targetRate: INPUT_SAMPLE_RATE, chunkSize: INPUT_SAMPLE_RATE / 10 },
  });
  node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
    if (onLevel) {
      const samples = new Int16Array(e.data);
      let sum = 0;
      for (let i = 0; i < samples.length; i++) sum += (samples[i] / 0x8000) ** 2;
      onLevel(Math.min(1, Math.sqrt(sum / samples.length) * 4));
    }
    onChunk(toBase64(new Uint8Array(e.data)));
  };
  source.connect(node);
  // Il worklet non produce audio: un gain a zero lo tiene nel grafo senza eco.
  const sink = ctx.createGain();
  sink.gain.value = 0;
  node.connect(sink).connect(ctx.destination);

  return {
    stop: () => {
      node.port.onmessage = null;
      source.disconnect();
      node.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    },
  };
}

/** Riproduzione in coda dei blocchi audio del modello, interrompibile. */
export class PcmPlayer {
  private ctx: AudioContext;
  private analyser: AnalyserNode;
  private samples: Float32Array<ArrayBuffer>;
  private nextTime = 0;
  private sources = new Set<AudioBufferSourceNode>();

  constructor() {
    this.ctx = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.samples = new Float32Array(this.analyser.fftSize);
    this.analyser.connect(this.ctx.destination);
  }

  /** Volume corrente (0..1) di cio' che si sta riproducendo. */
  level(): number {
    if (this.sources.size === 0) return 0;
    this.analyser.getFloatTimeDomainData(this.samples);
    let sum = 0;
    for (let i = 0; i < this.samples.length; i++) sum += this.samples[i] ** 2;
    return Math.min(1, Math.sqrt(sum / this.samples.length) * 5);
  }

  /** Va chiamato dentro il gesto dell'utente (Safari/iOS bloccano l'audio altrimenti). */
  async resume() {
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  get playing(): boolean {
    return this.sources.size > 0;
  }

  enqueue(base64Pcm: string) {
    const bytes = fromBase64(base64Pcm);
    const samples = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
    if (samples.length === 0) return;
    const buffer = this.ctx.createBuffer(1, samples.length, OUTPUT_SAMPLE_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 0x8000;

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.analyser);
    const startAt = Math.max(this.nextTime, this.ctx.currentTime + 0.02);
    src.start(startAt);
    this.nextTime = startAt + buffer.duration;
    this.sources.add(src);
    src.onended = () => this.sources.delete(src);
  }

  /** L'utente ha interrotto il modello: si butta l'audio ancora in coda. */
  flush() {
    for (const src of this.sources) {
      try {
        src.stop();
      } catch {
        /* gia' fermo */
      }
    }
    this.sources.clear();
    this.nextTime = 0;
  }

  close() {
    this.flush();
    void this.ctx.close();
  }
}
