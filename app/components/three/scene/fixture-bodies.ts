import {
  BoxGeometry,
  Color,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  Scene,
  Vector3,
} from 'three';
import type { BodyModel } from './fixture-adapter';

const BASE_COLOR = new Color(0x26262e);
// Matches the 2D canvas selection color (--primary yellow, #fbbf24).
const SELECTED_COLOR = new Color(0xfbbf24);

/**
 * One instanced box per fixture: keeps unlit fixtures visible and is the
 * raycast target for click-selection (instanceId → fixtureId).
 */
export class FixtureBodies {
  readonly mesh: InstancedMesh;
  private models: BodyModel[] = [];
  private geometry = new BoxGeometry(1, 1, 1);
  private material = new MeshBasicMaterial({ color: 0xffffff });
  private tmpMatrix = new Matrix4();
  private tmpQuat = new Quaternion();
  private tmpScale = new Vector3();

  constructor(private scene: Scene) {
    this.mesh = new InstancedMesh(this.geometry, this.material, 0);
    this.mesh.visible = false;
  }

  fixtureIdAt(instanceId: number): string | number | undefined {
    return this.models[instanceId]?.fixtureId;
  }

  get fixtureModels(): readonly BodyModel[] {
    return this.models;
  }

  rebuild(models: BodyModel[]): void {
    this.models = models;
    if (this.mesh.count !== models.length || this.mesh.instanceMatrix.count < models.length) {
      this.scene.remove(this.mesh);
      this.mesh.dispose();
      const next = new InstancedMesh(this.geometry, this.material, models.length);
      // Replace the readonly-typed mesh reference via defineProperty-free cast.
      (this as { mesh: InstancedMesh }).mesh = next;
      this.scene.add(next);
    } else if (!this.mesh.parent) {
      this.scene.add(this.mesh);
    }
    this.mesh.visible = models.length > 0;

    for (let i = 0; i < models.length; i++) {
      const m = models[i]!;
      this.tmpQuat.setFromEuler(m.euler);
      this.tmpScale.copy(m.size);
      this.tmpMatrix.compose(m.position, this.tmpQuat, this.tmpScale);
      this.mesh.setMatrixAt(i, this.tmpMatrix);
      this.mesh.setColorAt(i, BASE_COLOR);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.computeBoundingSphere();
  }

  setSelection(selected: Set<string | number>): void {
    for (let i = 0; i < this.models.length; i++) {
      this.mesh.setColorAt(i, selected.has(this.models[i]!.fixtureId) ? SELECTED_COLOR : BASE_COLOR);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
