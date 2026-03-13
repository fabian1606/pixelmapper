import { BaseConnector, type ConnectorMeta } from './base-connector';

export class SerialConnector extends BaseConnector {
  readonly meta: ConnectorMeta = {
    type: 'serial',
    label: 'USB Serial (ESP32)',
    icon: 'Usb',
  };

  baudRate: number;

  private port: SerialPort | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private readonly packet = new Uint8Array(513);
  private readAbort: AbortController | null = null;

  constructor(id: string, baudRate = 921600) {
    super(id);
    this.packet[0] = 0xff;
    this.baudRate = baudRate;
  }

  async connect() {
    this.status = 'connecting';
    this.errorMessage = null;
    try {
      this.port = await (navigator as any).serial.requestPort();
      await this.port!.open({ baudRate: this.baudRate });
      this.writer = this.port!.writable!.getWriter();
      this.status = 'connected';
      this.startReadLoop();
    } catch (e: any) {
      this.status = 'error';
      this.errorMessage = e?.message ?? 'Connection failed';
    }
  }

  async disconnect() {
    this.readAbort?.abort();
    this.readAbort = null;
    try {
      this.writer?.releaseLock();
      await this.port?.close();
    } catch (_) {}
    this.writer = null;
    this.port = null;
    this.status = 'disconnected';
    this.errorMessage = null;
  }

  sendFrame(dmxBuffer: Uint8Array) {
    if (this.status !== 'connected' || !this.writer) return;
    this.packet.set(dmxBuffer.subarray(0, 512), 1);
    this.writer.write(this.packet).catch(() => this.disconnect());
  }

  private startReadLoop() {
    this.readAbort = new AbortController();
    const port = this.port!;

    const run = async () => {
      const decoder = new TextDecoderStream();
      port.readable!.pipeTo(decoder.writable, { signal: this.readAbort!.signal }).catch(() => {});

      let partial = '';
      const reader = decoder.readable.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          partial += value;
          const lines = partial.split('\n');
          partial = lines.pop() ?? '';
          for (const line of lines) {
            const trimmed = line.trimEnd();
            if (trimmed) this.pushLog(trimmed);
          }
        }
      } catch (_) {
        // aborted or disconnected — expected
      } finally {
        reader.releaseLock();
      }
    };

    run();
  }

  override getConfig() {
    return { baudRate: this.baudRate };
  }
}
