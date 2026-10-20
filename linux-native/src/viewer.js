import { encodeFrame, FrameParser } from './websocket.js';

/**
 * Viewer channel: streams screenshots of a running profile over a WebSocket
 * and forwards user input (clicks, keys, scrolls) back to the page.
 *
 * The channel is created per profile and torn down with it, so one profile
 * can never observe another's frames.
 */
export class ViewerHub {
  constructor({ engine, storage }) {
    this.engine = engine;
    this.storage = storage;
    this.channels = new Map();
  }

  channelFor(profileId) {
    let channel = this.channels.get(profileId);
    if (!channel) {
      channel = { profileId, clients: new Set() };
      this.channels.set(profileId, channel);
    }
    return channel;
  }

  dropChannel(profileId) {
    this.channels.delete(profileId);
  }

  attach(profileId, socket) {
    const channel = this.channelFor(profileId);
    channel.clients.add(socket);
    this.sendSnapshot(profileId, socket);

    const parser = new FrameParser();

    const onData = async (chunk) => {
      let messages;
      try {
        messages = parser.push(chunk);
      } catch {
        socket.end();
        return;
      }

      for (const message of messages) {
        if (message.opcode === 0x8) {
          socket.end();
          return;
        }
        if (message.opcode === 0x9) {
          socket.write(encodeFrame(message.payload, { binary: true }));
          continue;
        }
        if (message.opcode !== 0x1) continue;

        let payload;
        try {
          payload = JSON.parse(message.payload.toString('utf8'));
        } catch {
          continue;
        }
        await this.handleInput(profileId, payload);
      }
    };

    socket.on('data', onData);
    const cleanup = () => {
      socket.off('data', onData);
      channel.clients.delete(socket);
      if (channel.clients.size === 0) this.dropChannel(profileId);
    };
    socket.on('close', cleanup);
    socket.on('error', cleanup);
  }

  async sendSnapshot(profileId, socket) {
    try {
      const { image } = await this.engine.screenshot(profileId);
      socket.write(encodeFrame(Buffer.from(image), { binary: true }));
    } catch {
      socket.write(
        encodeFrame(JSON.stringify({ type: 'error', message: 'profile is not running' })),
      );
    }
  }

  async handleInput(profileId, message) {
    if (!message || typeof message.type !== 'string') return;
    try {
      switch (message.type) {
        case 'navigate':
          await this.engine.navigate(profileId, String(message.url ?? ''));
          break;
        case 'click':
          await this.engine.click(profileId, Number(message.x), Number(message.y));
          break;
        case 'key':
          await this.engine.pressKey(profileId, String(message.key ?? ''));
          break;
        case 'scroll':
          await this.engine.scroll(profileId, Number(message.dy ?? 0));
          break;
        case 'evaluate':
          await this.engine.evaluate(profileId, String(message.expression ?? 'null'));
          break;
        default:
          return;
      }
      const { image } = await this.engine.screenshot(profileId);
      for (const client of this.channels.get(profileId)?.clients ?? []) {
        client.write(encodeFrame(Buffer.from(image), { binary: true }));
      }
    } catch (error) {
      const payload = JSON.stringify({ type: 'error', message: error.message });
      for (const client of this.channels.get(profileId)?.clients ?? []) {
        client.write(encodeFrame(payload));
      }
    }
  }
}
