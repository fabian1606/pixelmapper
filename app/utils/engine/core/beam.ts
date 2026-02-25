/**
 * Represents a single light beam within a fixture.
 * The beam's world position is derived from the fixture's `fixturePosition` + the beam's local offset.
 * Complex fixtures (e.g. moving heads with multiple LEDs) will have multiple beams, each with a local offset.
 */
export class Beam {
  /** ID of the beam within the fixture. */
  public id: string;

  /** Beam offset relative to the fixture's world position (in normalized 0-1 space). */
  public localX: number;
  public localY: number;

  constructor(id: string, localX: number = 0, localY: number = 0) {
    this.id = id;
    this.localX = localX;
    this.localY = localY;
  }
}
