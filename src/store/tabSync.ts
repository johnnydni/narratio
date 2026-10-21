import * as Y from 'yjs';

/**
 * Synchronisiert ein Y.Doc live zwischen Fenstern und Tabs desselben Browsers (P0-Gate).
 *
 * Protokoll (absichtlich klein):
 * - "sv":  ein Fenster schickt seinen Zustandsvektor; Empfänger antworten mit genau dem,
 *          was dem Absender fehlt ("up"). Mit ask=true fragt der Empfänger zurück, damit auch
 *          er alles bekommt, was nur der Neue hatte.
 * - "up":  ein binäres Yjs-Update; wird mit dieser Instanz als Ursprung angewendet,
 *          damit es nicht zurückgesendet wird.
 * - "ping"/"bye": Anwesenheit, für die Anzeige "2 Fenster verbunden".
 *
 * Über einen Server läuft später derselbe Mechanismus (Updates sind kommutativ und idempotent),
 * dieser Kanal bleibt dann für lokale Fenster erhalten.
 */

export interface ChannelLike {
  postMessage(msg: unknown): void;
  close(): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

type Msg =
  | { t: 'sv'; from: string; sv: Uint8Array; ask: boolean }
  | { t: 'up'; from: string; u: Uint8Array }
  | { t: 'ping'; from: string; reply: boolean }
  | { t: 'bye'; from: string };

export class TabSync {
  readonly clientKey = Math.random().toString(36).slice(2);
  private peers = new Map<string, number>();
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return;
    this.post({ t: 'up', from: this.clientKey, u: update });
  };

  constructor(
    private readonly doc: Y.Doc,
    private readonly channel: ChannelLike,
  ) {
    channel.onmessage = (ev) => this.receive(ev.data as Msg);
    doc.on('update', this.onUpdate);
    this.requestSync();
    this.post({ t: 'ping', from: this.clientKey, reply: true });
    this.timer = setInterval(() => {
      this.post({ t: 'ping', from: this.clientKey, reply: false });
      const now = Date.now();
      let changed = false;
      for (const [k, seen] of this.peers) {
        if (now - seen > 6000) {
          this.peers.delete(k);
          changed = true;
        }
      }
      if (changed) this.emit();
    }, 2000);
  }

  /** Fragt alle anderen Fenster nach fehlenden Änderungen. */
  requestSync(): void {
    this.post({ t: 'sv', from: this.clientKey, sv: Y.encodeStateVector(this.doc), ask: true });
  }

  get peerCount(): number {
    return this.peers.size;
  }

  onPeersChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  destroy(): void {
    this.post({ t: 'bye', from: this.clientKey });
    if (this.timer) clearInterval(this.timer);
    this.doc.off('update', this.onUpdate);
    this.channel.onmessage = null;
    this.channel.close();
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }

  private post(msg: Msg) {
    this.channel.postMessage(msg);
  }

  private seen(from: string) {
    const had = this.peers.has(from);
    this.peers.set(from, Date.now());
    if (!had) this.emit();
  }

  private receive(msg: Msg) {
    if (!msg || msg.from === this.clientKey) return;
    switch (msg.t) {
      case 'sv': {
        this.seen(msg.from);
        const diff = Y.encodeStateAsUpdate(this.doc, msg.sv);
        // Ein leeres Update hat 2 Byte; nur senden, wenn etwas fehlt.
        if (diff.byteLength > 2) this.post({ t: 'up', from: this.clientKey, u: diff });
        if (msg.ask) this.post({ t: 'sv', from: this.clientKey, sv: Y.encodeStateVector(this.doc), ask: false });
        break;
      }
      case 'up':
        this.seen(msg.from);
        Y.applyUpdate(this.doc, msg.u, this);
        break;
      case 'ping':
        this.seen(msg.from);
        if (msg.reply) this.post({ t: 'ping', from: this.clientKey, reply: false });
        break;
      case 'bye':
        if (this.peers.delete(msg.from)) this.emit();
        break;
    }
  }
}
