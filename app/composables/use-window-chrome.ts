/**
 * Window chrome for layout (ADR 0003): whether the page sits under a
 * transparent title bar, how much room the traffic lights need, and whether
 * the app header (which then doubles as the title bar) is on screen.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { getWindowChrome } from '#platform';

/** Window chrome, resolved once per app (static for the window's lifetime). */
const chrome = getWindowChrome();

/** Native fullscreen: the traffic lights are hidden, so no inset is needed. */
const fullscreen = ref(false);

// Client-only subscription for the app's lifetime (one window, never torn down).
if (import.meta.client && chrome.onFullscreenChange) {
  chrome.onFullscreenChange((value) => { fullscreen.value = value; });
}

/** Traffic-light inset, dropped while the window is fullscreen. */
const trafficLightInset = computed(() => (fullscreen.value ? 0 : chrome.trafficLightInset));

export function useWindowChrome() {
  // Pages without the app header need their own drag strip under the title bar.
  const headerMounted = useState('window-chrome:header-mounted', () => false);
  return { overlayTitleBar: chrome.overlayTitleBar, trafficLightInset, fullscreen, headerMounted };
}

/** Marks the app header as the window's title bar while it is mounted. */
export function useAsTitleBar(): void {
  const { headerMounted } = useWindowChrome();
  onMounted(() => { headerMounted.value = true; });
  onBeforeUnmount(() => { headerMounted.value = false; });
}
