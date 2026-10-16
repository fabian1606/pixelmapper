/**
 * Web Serial implementation of the platform `SerialApi` (ADR 0003).
 *
 * Wraps a granted `SerialPort` behind the transport-shaped contract: a read
 * loop pushes chunks to `onData`, an unexpected end reports `onDrop`.
 * Chromium only; `createWebSerial()` returns `null` elsewhere.
 */
import type { SerialApi, SerialConnection, SerialEvents, SerialOpenOptions, SerialPortHandle } from '@pixelmapper/extension-api';

/** Opens a granted Web Serial port and runs its read loop. */
async function openPort(port: SerialPort, options: SerialOpenOptions, events: SerialEvents): Promise<SerialConnection> {
  await port.open({ baudRate: options.baudRate });
  const writer = port.writable!.getWriter();
  const reader = port.readable!.getReader();
  let closing = false;

  // Read loop: forwards chunks until the reader ends; an end not caused by close() is a drop.
  const readLoopDone = (async () => {
    let dropError: Error | null = null;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          if (!closing) dropError = new Error('Serial port closed');
          break;
        }
        if (value) events.onData(value);
      }
    }
    catch (e) {
      if (!closing) dropError = e as Error;
    }
    finally {
      try { reader.releaseLock(); } catch { /* released */ }
    }
    if (dropError) events.onDrop(dropError);
  })();

  return {
    write: data => writer.write(data),
    async close() {
      if (closing) return;
      closing = true;
      await reader.cancel().catch(() => {});
      await readLoopDone;
      try { writer.releaseLock(); } catch { /* not locked */ }
      try { await port.close(); } catch { /* already closed */ }
    },
  };
}

/** Returns the Web Serial `SerialApi`, or `null` when the browser has no Web Serial. */
export function createWebSerial(): SerialApi | null {
  const serial = typeof navigator !== 'undefined' ? (navigator as Navigator & { serial?: Serial }).serial : undefined;
  if (!serial) return null;
  return {
    async requestPort(): Promise<SerialPortHandle> {
      const port = await serial.requestPort();
      return { open: (options, events) => openPort(port, options, events) };
    },
  };
}
