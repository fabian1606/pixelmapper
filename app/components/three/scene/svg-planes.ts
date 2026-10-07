import {
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
} from 'three';
import type { SvgPlaneModel } from './fixture-adapter';

/** Longest edge of the rasterized SVG texture, px. */
const MAX_TEXTURE_EDGE = 512;

/**
 * SVG fixture artwork as textured planes lying in the fixture footprint —
 * the 3D counterpart of the 2D canvas's svg_render. The plane shows the
 * static artwork; DMX state is conveyed by the PixelCloud dots sitting on
 * the SVG element centroids (beam localX/localY).
 *
 * Textures are rasterized asynchronously (SVG string → blob URL → Image →
 * canvas) and cached by SVG source, so drag-rebuilds never re-rasterize.
 * Client-only: the scene manager is dynamically imported, DOM APIs are safe.
 */
export class SvgPlanes {
  private group = new Group();
  private textures = new Map<string, CanvasTexture>();
  /** SVG sources currently rasterizing — prevents duplicate loads. */
  private loading = new Set<string>();
  private disposed = false;

  constructor(private scene: Scene) {
    this.scene.add(this.group);
  }

  rebuild(models: SvgPlaneModel[]): void {
    // Planes are few and cheap — dispose and rebuild like FixtureBodies.
    for (const child of [...this.group.children]) {
      const mesh = child as Mesh;
      mesh.geometry.dispose();
      (mesh.material as MeshBasicMaterial).dispose(); // material only — textures stay cached
      this.group.remove(mesh);
    }

    for (const m of models) {
      const geometry = new PlaneGeometry(m.width, m.height);
      // Lay the plane flat facing +Y: the texture top edge points to -Z,
      // matching the 2D top-down view (SVG y-down → world Z+).
      geometry.rotateX(-Math.PI / 2);
      const material = new MeshBasicMaterial({ transparent: true, depthWrite: false });
      const mesh = new Mesh(geometry, material);
      mesh.position.copy(m.position);
      mesh.quaternion.setFromEuler(m.euler);
      // Above the body box, below the additive pixels (renderOrder 5).
      mesh.renderOrder = 2;
      mesh.visible = false;
      this.group.add(mesh);

      const cached = this.textures.get(m.svgData);
      if (cached) {
        material.map = cached;
        material.needsUpdate = true;
        mesh.visible = true;
      } else {
        this.loadTexture(m.svgData).then((texture) => {
          if (!texture || this.disposed || mesh.parent !== this.group) return;
          material.map = texture;
          material.needsUpdate = true;
          mesh.visible = true;
        });
      }
    }
  }

  /** Rasterizes an SVG source to a cached CanvasTexture. Resolves null on failure. */
  private async loadTexture(svgData: string): Promise<CanvasTexture | null> {
    if (this.loading.has(svgData)) {
      // Another plane kicked off the same rasterization — wait for the cache.
      await new Promise<void>((resolve) => {
        const poll = () => {
          if (!this.loading.has(svgData) || this.disposed) resolve();
          else setTimeout(poll, 50);
        };
        poll();
      });
      return this.textures.get(svgData) ?? null;
    }
    this.loading.add(svgData);
    try {
      const image = await this.rasterize(svgData);
      if (!image || this.disposed) return null;
      const texture = new CanvasTexture(image);
      texture.colorSpace = SRGBColorSpace;
      this.textures.set(svgData, texture);
      return texture;
    } catch {
      return null;
    } finally {
      this.loading.delete(svgData);
    }
  }

  private rasterize(svgData: string): Promise<HTMLCanvasElement | null> {
    // SVGs without explicit width/height rasterize as 0×0 in some browsers —
    // derive pixel dimensions from the viewBox (same trick as the 2D side's
    // svg-element-positions.ts) before handing the source to an Image.
    let width = MAX_TEXTURE_EDGE;
    let height = MAX_TEXTURE_EDGE;
    try {
      const doc = new DOMParser().parseFromString(svgData, 'image/svg+xml');
      const svgEl = doc.documentElement;
      if (doc.querySelector('parsererror')) return Promise.resolve(null);
      const vb = svgEl.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
      const [, , vbW = 500, vbH = 500] = vb ?? [];
      if (vbW > 0 && vbH > 0) {
        const scale = MAX_TEXTURE_EDGE / Math.max(vbW, vbH);
        width = Math.max(1, Math.round(vbW * scale));
        height = Math.max(1, Math.round(vbH * scale));
      }
      svgEl.setAttribute('width', String(width));
      svgEl.setAttribute('height', String(height));
      svgData = new XMLSerializer().serializeToString(svgEl);
    } catch {
      return Promise.resolve(null);
    }

    const url = URL.createObjectURL(new Blob([svgData], { type: 'image/svg+xml' }));
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d')?.drawImage(img, 0, 0, width, height);
        resolve(canvas);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    });
  }

  dispose(): void {
    this.disposed = true;
    this.rebuild([]);
    this.scene.remove(this.group);
    for (const texture of this.textures.values()) texture.dispose();
    this.textures.clear();
  }
}
