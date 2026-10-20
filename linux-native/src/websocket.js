import crypto from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/**
 * Minimal RFC 6455 server-side WebSocket support.
 *
 * The viewer needs one bidirectional channel (frames down, input up) and
 * nothing more, so the project avoids an extra runtime dependency for it.
 */

export function isWebSocketUpgrade(req) {
  return (
    String(req.headers.upgrade ?? '').toLowerCase() === 'websocket' &&
    typeof req.headers['sec-websocket-key'] === 'string'
  );
}

export function acceptKey(key) {
  return crypto
    .createHash('sha1')
    .update(key + GUID)
    .digest('base64');
}

export function handshake(req, socket) {
  const headers = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey(req.headers['sec-websocket-key'])}`,
  ];
  socket.write(`${headers.join('\r\n')}\r\n\r\n`);
}

export function encodeFrame(payload, { binary = false } = {}) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
  const opcode = binary ? 0x2 : 0x1;
  const length = data.length;

  let header;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  header[0] = 0x80 | opcode;
  return Buffer.concat([header, data]);
}

/**
 * Decode one frame from a client. Returns null when more bytes are needed.
 * Client frames are always masked, per the specification.
 */
/**
 * Incremental frame parser.
 *
 * A TCP read can deliver half a frame or several frames at once, so the
 * decoder must buffer instead of discarding an incomplete frame. It also
 * reassembles continuation frames, which is how some clients split a message.
 */
export class FrameParser {
  constructor({ maxPayloadBytes = 1024 * 1024 } = {}) {
    this.buffer = Buffer.alloc(0);
    this.maxPayloadBytes = maxPayloadBytes;
    this.fragments = [];
    this.fragmentOpcode = null;
  }

  /** Feed raw bytes and return the list of complete messages. */
  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages = [];

    for (;;) {
      const frame = decodeFrame(this.buffer);
      if (!frame) break;
      this.buffer = this.buffer.subarray(frame.consumed);

      if (frame.opcode === 0x8) {
        messages.push({ opcode: 0x8, payload: frame.payload });
        break;
      }
      if (frame.opcode === 0x9) {
        messages.push({ opcode: 0x9, payload: frame.payload });
        continue;
      }
      if (frame.opcode === 0xa) {
        continue;
      }

      if (frame.opcode === 0x0) {
        if (this.fragmentOpcode === null) continue;
        this.fragments.push(frame.payload);
      } else {
        this.fragments = [frame.payload];
        this.fragmentOpcode = frame.opcode;
      }

      if (!frame.fin) continue;

      const payload = Buffer.concat(this.fragments);
      const opcode = this.fragmentOpcode;
      this.fragments = [];
      this.fragmentOpcode = null;
      messages.push({ opcode, payload });
    }

    return messages;
  }
}

export function decodeFrame(buffer) {
  if (buffer.length < 2) return null;

  const fin = (buffer[0] & 0x80) !== 0;
  const opcode = buffer[0] & 0x0f;
  const masked = (buffer[1] & 0x80) !== 0;
  let length = buffer[1] & 0x7f;
  let offset = 2;

  if (length === 126) {
    if (buffer.length < offset + 2) return null;
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) return null;
    const big = buffer.readBigUInt64BE(offset);
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('frame too large');
    }
    length = Number(big);
    offset += 8;
  }

  let mask = null;
  if (masked) {
    if (buffer.length < offset + 4) return null;
    mask = buffer.subarray(offset, offset + 4);
    offset += 4;
  }

  if (buffer.length < offset + length) return null;

  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (mask) {
    for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
  }

  return { fin, opcode, payload, consumed: offset + length };
}

export function closeFrame(code = 1000, reason = '') {
  const body = Buffer.alloc(2 + Buffer.byteLength(reason, 'utf8'));
  body.writeUInt16BE(code, 0);
  body.write(reason, 2, 'utf8');
  return encodeFrame(body, { binary: true });
}
