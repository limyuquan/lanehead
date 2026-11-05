import { describe, expect, it } from 'vitest';
import { parseRequest } from './host';

describe('parseRequest', () => {
  it('accepts a JSON object with a string op and object args', () => {
    expect(parseRequest('{"v":1,"id":3,"op":"tabs","args":{}}')).toEqual({
      v: 1,
      id: 3,
      op: 'tabs',
      args: {},
    });
    expect(parseRequest('{"op":"status"}')).toEqual({ op: 'status' });
  });

  it.each([
    'null',
    'not json',
    '[]',
    '"tabs"',
    '{"id":1}',
    '{"op":7}',
    '{"op":"tabs","args":null}',
    '{"op":"tabs","args":[1]}',
  ])('rejects %s', (line) => {
    expect(parseRequest(line)).toBeUndefined();
  });

  it('rejects lines over 1 MB', () => {
    expect(parseRequest(`{"op":"tabs","x":"${'a'.repeat(1 << 20)}"}`)).toBeUndefined();
  });
});
