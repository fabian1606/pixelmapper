import { defineStore } from 'pinia';
import { ref, markRaw } from 'vue';
import { useEngineStore } from '~/stores/engine-store';

/**
 * WebSerial connection to an ESP32.
 * Sends the full 512-byte DMX buffer every frame.
 *
 * Packet format (513 bytes):
 *   [0xFF] [dmx[0] ... dmx[511]]
 * The ESP32 syncs on the 0xFF start byte.
 */
export const useSerialStore = defineStore('serial', () => {
  const port = ref<SerialPort | null>(null);
  const writer = ref<WritableStreamDefaultWriter<Uint8Array> | null>(null);
  const connected = ref(false);
  const error = ref<string | null>(null);

  // We keep a reference to the animationFrame hook so we can cancel it
  let rafId: number | null = null;
  const packet = new Uint8Array(513);
  packet[0] = 0xff; // sync byte

  async function connect() {
    error.value = null;
    try {
      const selectedPort = await (navigator as any).serial.requestPort();
      await selectedPort.open({ baudRate: 921600 });

      port.value = markRaw(selectedPort);
      writer.value = markRaw(selectedPort.writable.getWriter());
      connected.value = true;

      startSendLoop();
    } catch (e: any) {
      error.value = e?.message ?? 'Connection failed';
    }
  }

  async function disconnect() {
    stopSendLoop();
    try {
      writer.value?.releaseLock();
      await port.value?.close();
    } catch (_) {}
    writer.value = null;
    port.value = null;
    connected.value = false;
  }

  function startSendLoop() {
    const engineStore = useEngineStore();

    const loop = () => {
      if (!connected.value || !writer.value) return;

      const dmx = engineStore.engine?.dmxBuffer;
      if (dmx) {
        // Copy current DMX values into packet (bytes 1–512)
        packet.set(dmx.subarray(0, 512), 1);
        writer.value.write(packet).catch(() => disconnect());
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
  }

  function stopSendLoop() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  return { connected, error, connect, disconnect };
});
