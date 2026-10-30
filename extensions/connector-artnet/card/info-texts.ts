/**
 * Plain-English explanations behind the ⓘ tips of the Art-Net connector
 * card (WP13). Kept in one module so every place that names a term explains
 * it the same way. One or two sentences each; no protocol jargon beyond the
 * term itself.
 */

/** Ids of the explained terms. */
export type InfoTopic =
  | 'portAddress'
  | 'universeMapping'
  | 'direction'
  | 'rdm'
  | 'merge'
  | 'outputStyle'
  | 'failsafe'
  | 'failsafeCustom'
  | 'recordScene'
  | 'backgroundDiscovery'
  | 'dmxTiming'
  | 'identifyNode'
  | 'identifyDevice'
  | 'deviceStates'
  | 'rediscover'
  | 'autoAddress'
  | 'addDevices'
  | 'networkMode'
  | 'networkApply'
  | 'firmwareUpdate'
  | 'nodeFirmware'
  | 'nodeNames'
  | 'nodeAdvanced'
  | 'portAdvanced'
  | 'manualTarget';

/** Title (the term) and explanation of every topic. */
export const INFO_TEXTS: Readonly<Record<InfoTopic, { title: string; text: string }>> = {
  portAddress: {
    title: 'Port-Address',
    text: 'The Art-Net address a node port listens to, written Net:Sub-Net:Universe (0–32767 in total). Other Art-Net software reaches the port by this number; Pixelmapper sends to it automatically.',
  },
  universeMapping: {
    title: 'Universe mapping',
    text: 'Which Pixelmapper universe this port outputs. By default it equals the port\'s Port-Address; if they differ, DMX still arrives — the node just keeps its own number.',
  },
  direction: {
    title: 'Direction',
    text: 'Output sends DMX from Pixelmapper to the fixtures on this port. Input receives DMX from a desk into Art-Net. Off switches the port\'s DMX line off.',
  },
  rdm: {
    title: 'RDM',
    text: 'Remote Device Management: lets Pixelmapper find the fixtures on a port and read or change their address and mode over the DMX cable. Fixtures without RDM still receive DMX.',
  },
  merge: {
    title: 'Merge HTP / LTP',
    text: 'What the port does when two controllers send to it at once. HTP keeps the highest value of each channel, LTP the latest change.',
  },
  outputStyle: {
    title: 'Output style',
    text: 'Continuous sends DMX on the cable all the time (recommended). Delta only sends when values change, which some older fixtures need.',
  },
  failsafe: {
    title: 'Failsafe',
    text: 'What the node outputs when Art-Net stops (Pixelmapper closed, cable unplugged): Hold keeps the last look, Zero blacks out, Full goes to full, Scene plays a recorded look. It is a setting of the node\'s ports, not of the fixtures.',
  },
  failsafeCustom: {
    title: 'Custom per port',
    text: 'Off: one failsafe mode for every port of the node. On: each port gets its own mode in its port settings.',
  },
  recordScene: {
    title: 'Record scene',
    text: 'Stores what the port outputs right now as its failsafe scene. Used when the failsafe mode is Scene; the previously stored scene is replaced.',
  },
  backgroundDiscovery: {
    title: 'Background discovery',
    text: 'The node keeps looking for newly connected RDM fixtures while DMX runs. Switch it off if a fixture flickers during discovery.',
  },
  dmxTiming: {
    title: 'DMX timing',
    text: 'Low-level timing of the DMX signal on this port: break and mark-after-break lengths and the refresh rate. Only change them if a fixture misses frames.',
  },
  identifyNode: {
    title: 'Identify node',
    text: 'Makes the node\'s display flash so you can find it. Switched off again when you close this card.',
  },
  identifyDevice: {
    title: 'Identify',
    text: 'Makes the fixture flash so you can see which one it is. Switched off again when you close this card.',
  },
  deviceStates: {
    title: 'Device states',
    text: 'New: found but not on the canvas yet. Linked: on the canvas, changes go to the device. Conflict: its channels overlap another fixture. Mismatch: the device reports another address or mode than its fixture. Unlinked: the fixture was moved out of the port\'s universe, so changes are not sent. Offline: not found on the port any more.',
  },
  rediscover: {
    title: 'Rediscover',
    text: 'Clears the port\'s list of RDM fixtures and searches again — use it after plugging fixtures in or out.',
  },
  autoAddress: {
    title: 'Auto-address',
    text: 'Gives all linked fixtures of this node new DMX addresses, gap-free in canvas order, and writes them to the devices.',
  },
  addDevices: {
    title: 'Add',
    text: 'Puts the device on the canvas as a fixture with its current address and mode. Add all does it for every new device in one undo step.',
  },
  networkMode: {
    title: 'DHCP / static',
    text: 'DHCP: the node gets its IP address from your router. Static: the node always uses the address entered here. Art-Net networks often use static 2.x.x.x or 10.x.x.x addresses.',
  },
  networkApply: {
    title: 'Applying network changes',
    text: 'The node restarts its network; Pixelmapper then follows it to its new address. If the node lands in another subnet, your computer may not reach it any more.',
  },
  firmwareUpdate: {
    title: 'Update tubes',
    text: 'Writes a new firmware image to the RDM fixtures on this node\'s ports (one per port at a time). Fixtures keep their address and mode.',
  },
  nodeFirmware: {
    title: 'Firmware',
    text: 'The software version running on the node itself, and its bootloader. Shown for support; the node\'s own firmware is updated with the node tool.',
  },
  nodeNames: {
    title: 'Node names',
    text: 'The short name (up to 17 characters) and long name (up to 63) the node announces on the network. Other Art-Net software shows them too.',
  },
  nodeAdvanced: {
    title: 'Advanced node settings',
    text: 'Every other setting the node offers over RDM, such as display brightness and discovery intervals. The defaults suit most setups.',
  },
  portAdvanced: {
    title: 'Advanced port settings',
    text: 'Merge behaviour, output style and DMX timing of this port. The defaults suit most setups.',
  },
  manualTarget: {
    title: 'Device without discovery',
    text: 'This device does not answer Art-Net discovery, so Pixelmapper sends DMX straight to its IP address. Set which Port-Address each Pixelmapper universe goes to.',
  },
};
