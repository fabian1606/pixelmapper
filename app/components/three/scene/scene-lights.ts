import { DirectionalLight, HemisphereLight, Scene } from 'three';

/**
 * Soft studio lighting for the lit housing materials (fixture bodies,
 * moving-head yokes/heads). Everything light-emitting (pixels, segments,
 * beams, lenses) and the stage floor use unlit materials and ignore it.
 */
export function addSceneLights(scene: Scene): () => void {
  // Sky/ground fill: keeps the shadow side of dark housings readable.
  const hemi = new HemisphereLight(0xd0d4e0, 0x202026, 3.2);
  // Key light from the front-top, matching the default camera side.
  const key = new DirectionalLight(0xffffff, 2.4);
  key.position.set(6, 10, 8);
  // Rim light from behind so silhouettes separate from the dark stage.
  const rim = new DirectionalLight(0x9aa4c0, 1.2);
  rim.position.set(-6, 4, -8);
  scene.add(hemi, key, rim);
  return () => {
    scene.remove(hemi, key, rim);
    hemi.dispose();
    key.dispose();
    rim.dispose();
  };
}
