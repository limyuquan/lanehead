/**
 * Native messaging framing (browser ↔ host): a 4-byte length in native byte order, then UTF-8
 * JSON. Every platform the host runs on (x64, arm64) is little-endian.
 */

export function encode(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message));
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length);
  return Buffer.concat([head, body]);
}

/** A decoder: feed it stdin chunks as they come; it returns the messages they complete. */
export function decoder(): (chunk: Buffer) => unknown[] {
  let pending = Buffer.alloc(0);
  return (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    const out: unknown[] = [];
    while (pending.length >= 4) {
      const end = 4 + pending.readUInt32LE(0);
      if (pending.length < end) break;
      out.push(JSON.parse(pending.subarray(4, end).toString('utf8')));
      pending = pending.subarray(end);
    }
    return out;
  };
}
