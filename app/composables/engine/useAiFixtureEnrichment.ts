import { ref } from 'vue';
import type { OflFixture } from '~/utils/ofl/types';

export interface ShutterProposal {
  kind: 'shutter';
  channelName: string;
  dmxMin: number;
  dmxMax: number;
  shutterEffect: 'Open' | 'Closed' | 'Strobe' | 'Pulse' | 'RampUp' | 'RampDown' | 'RampUpDown';
  speed?: string;
  reason: string;
}

export interface WheelSlotProposal {
  kind: 'wheelSlotColor';
  wheelName: string;
  slotNumber: number;
  slotType: 'Open' | 'Closed' | 'Color' | 'Gobo';
  colors?: string[];
  reason: string;
}

export interface DimmerProposal {
  kind: 'dimmerDefault';
  channelName: string;
  dmxMin: number;
  dmxMax: number;
  reason: string;
}

export type EnrichmentProposal = ShutterProposal | WheelSlotProposal | DimmerProposal;

/**
 * Reads an SSE stream shaped like { status } | { success, data } | { error },
 * shared by every aiBackendService extraction/enrichment endpoint.
 */
async function readSseStream(
  response: Response,
  onStatus: (status: string) => void,
): Promise<any> {
  if (!response.body) throw new Error('No response body from server.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';

    for (const part of parts) {
      for (const line of part.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        try {
          const json = JSON.parse(line.substring(6));
          if (json.status) onStatus(json.status);
          else if (json.success) return json.data;
          else if (json.error) throw new Error(json.details || json.error);
        } catch (e) {
          if (e instanceof Error && e.message !== undefined && !(e instanceof SyntaxError)) throw e;
        }
      }
    }
  }
  throw new Error('Stream ended without a result.');
}

/**
 * Uploads a fixture's manual PDF alongside its current OFL definition and
 * asks the AI backend to propose corrections to shutter/dimmer/wheel-slot
 * behavior — the parts that determine how the fixture renders in the 2D/3D
 * preview but are easy to get wrong by hand.
 */
export function useAiFixtureEnrichment() {
  const isEnriching = ref(false);
  const enrichStatus = ref('');
  const enrichError = ref('');
  const proposals = ref<EnrichmentProposal[]>([]);

  async function enrichFromManual(existingFixture: OflFixture, file: File) {
    isEnriching.value = true;
    enrichStatus.value = 'Uploading manual...';
    enrichError.value = '';
    proposals.value = [];

    try {
      const formData = new FormData();
      formData.append('manualPdf', file);
      formData.append('existingOfl', JSON.stringify(existingFixture));

      const runtimeConfig = useRuntimeConfig();
      const baseUrl = runtimeConfig.public.aiBackendUrl || 'http://localhost:4000';
      const response = await fetch(`${baseUrl}/enrich-fixture-pdf`, { method: 'POST', body: formData });

      const data = await readSseStream(response, (status) => { enrichStatus.value = status; });
      proposals.value = data?.proposals ?? [];
    } catch (err: any) {
      console.error('AI Enrichment Error:', err);
      enrichError.value = err.message || 'An error occurred during enrichment.';
    } finally {
      isEnriching.value = false;
    }
  }

  return { isEnriching, enrichStatus, enrichError, proposals, enrichFromManual };
}
