import { describe, expect, it } from 'vitest';
import { decoder, encode } from './frames';

describe('native frames', () => {
  it('length counts UTF-8 bytes', () => {
    const frame = encode({ v: 'é' });
    expect(frame.readUInt32LE(0)).toBe(frame.length - 4);
    expect(frame.length - 4).toBe(JSON.stringify({ v: 'é' }).length + 1);
  });

  it('decodes frames split anywhere and several per chunk', () => {
    const messages = [{ a: 1 }, { hello: { instance: 'ab12' } }, { s: 'x'.repeat(70_000) }];
    const bytes = Buffer.concat(messages.map(encode));
    for (const size of [1, 3, 5, 4096, bytes.length]) {
      const decode = decoder();
      const out: unknown[] = [];
      for (let i = 0; i < bytes.length; i += size) out.push(...decode(bytes.subarray(i, i + size)));
      expect(out).toEqual(messages);
    }
  });
});
