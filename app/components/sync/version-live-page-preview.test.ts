/**
 * Live page miniature of the version-history hover preview (happy-dom):
 * highlight classes / data attributes, dimmed unchanged widgets, removed
 * text, the added-page frame, page switching and a 100-widget render timing.
 */
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import type { LivePage, LiveWidget } from '~/utils/live/types';
import type { LivePageHighlight } from '~/utils/sync/version-preview/highlight-types';
import VersionLivePagePreview from './VersionLivePagePreview.vue';

/** Widget with defaults. */
function widget(id: string, over: Partial<LiveWidget> = {}): LiveWidget {
  return { id, type: 'button', gridX: 0, gridY: 0, gridW: 3, gridH: 3, mapping: { type: 'none' }, ...over };
}

/** Page with defaults. */
function page(id: string, widgets: LiveWidget[]): LivePage {
  return { id, name: `Page ${id}`, columns: 60, aspectRatioW: 16, aspectRatioH: 9, gridSize: 32, backgroundColor: '#0a0a0a', widgets };
}

const changed: LivePageHighlight = {
  status: 'changed',
  page: page('A', [widget('a', { label: 'Go' }), widget('b', { type: 'slider', gridX: 4 }), widget('c', { type: 'acme/knob', gridX: 8 })]),
  addedWidgets: ['a'],
  changedWidgets: ['b'],
  removedWidgets: [{ id: 'x', type: 'button', label: 'Strobe' }, { id: 'y', type: 'xy', label: '' }],
  sectionsChanged: false,
};

const added: LivePageHighlight = {
  status: 'added', page: page('B', [widget('d')]), addedWidgets: ['d'], changedWidgets: [], removedWidgets: [], sectionsChanged: false,
};

describe('VersionLivePagePreview', () => {
  it('highlights added and changed widgets and dims the rest', () => {
    const w = mount(VersionLivePagePreview, { props: { pages: [changed] } });
    const byStatus = (s: string) => w.find(`[data-testid="version-live-widget"][data-status="${s}"]`);
    expect(byStatus('added').classes()).toContain('outline-emerald-400');
    expect(byStatus('changed').classes()).toContain('outline-amber-400');
    expect(byStatus('same').classes()).toContain('opacity-60');
    expect(w.text()).toContain('Go');
    expect(w.text()).toContain('Knob');
    expect(w.get('[data-testid="version-live-preview"]').attributes('aria-label'))
      .toBe('Live page Page A: 1 widget added, 1 changed, 2 removed');
  });

  it('lists removed widgets and pages', () => {
    const w = mount(VersionLivePagePreview, { props: { pages: [changed], removedPages: [{ id: 'p', name: 'Intro' }] } });
    const lines = w.findAll('[data-testid="version-live-removed"]').map(l => l.text());
    expect(lines).toEqual(['Removed: Strobe, XY', 'Removed page: Intro']);
  });

  it('shows the most changed page first and switches pages', async () => {
    const w = mount(VersionLivePagePreview, { props: { pages: [added, changed] } });
    expect(w.get('[data-testid="version-live-page-name"]').text()).toBe('Page A');
    expect(w.get('[data-testid="version-live-pager"]').text()).toContain('1/2');
    await w.get('button[aria-label="Next page"]').trigger('click');
    expect(w.get('[data-testid="version-live-page-name"]').text()).toBe('Page B');
    // Added page: frame instead of per-widget outlines.
    expect(w.get('[data-testid="version-live-widget"]').classes()).not.toContain('outline-emerald-400');
    await w.get('button[aria-label="Previous page"]').trigger('click');
    expect(w.get('[data-testid="version-live-page-name"]').text()).toBe('Page A');
  });

  it('renders 100 widgets quickly', () => {
    const types = ['button', 'slider', 'xy', 'color', 'label', 'beat', 'fixture-preview', 'controller-twin', 'acme/knob'] as const;
    const widgets = Array.from({ length: 100 }, (_, i) => widget(`w${i}`, { type: types[i % types.length], gridX: (i % 20) * 3, gridY: Math.floor(i / 20) * 3 }));
    const pages = [{ ...changed, page: page('Big', widgets), changedWidgets: ['w1', 'w50'], addedWidgets: [] }];
    const t0 = performance.now();
    const w = mount(VersionLivePagePreview, { props: { pages } });
    const ms = performance.now() - t0;
    expect(w.findAll('[data-testid="version-live-widget"]')).toHaveLength(100);
    console.info(`[version-live-preview] 100 widgets mounted in ${ms.toFixed(1)} ms (happy-dom)`);
    expect(ms).toBeLessThan(1000);
  });
});
