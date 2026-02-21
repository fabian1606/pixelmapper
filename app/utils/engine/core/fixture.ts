import type { ChannelType } from '../types';
import { type Channel, RedChannel, GreenChannel, BlueChannel, DimmerChannel } from './channel';

export class Fixture {
  id: string | number;
  channels: Channel[];

  constructor(id: string | number, channels: Channel[] = []) {
    this.id = id;
    this.channels = channels;
  }

  /**
   * Retreives all channels of the specified type from this fixture.
   */
  getChannelsByType(type: ChannelType): Channel[] {
    return this.channels.filter(c => c.type === type);
  }

  /**
   * Updates a specific channel type with a new value.
   * If there are multiple channels of the same type, all are updated.
   */
  updateChannelValue(type: ChannelType, value: number) {
    const channels = this.getChannelsByType(type);
    for (const channel of channels) {
      channel.value = value;
    }
  }

  /**
   * Factory method: Creates a generic RGB fixture.
   */
  static createRGBFixture(id: number | string): Fixture {
    return new Fixture(id, [
      new RedChannel(),
      new GreenChannel(),
      new BlueChannel(),
      new DimmerChannel(), // Optional, common to have dimmer
    ]);
  }
}
