import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';

import { idParameterSchema } from './params.js';

describe('idParameterSchema', () => {
  it('accepts string id', () => {
    expect(Value.Check(idParameterSchema, { id: 'abc-123' })).toBe(true);
  });

  it('rejects missing id', () => {
    expect(Value.Check(idParameterSchema, {})).toBe(false);
  });

  it('rejects non-string id', () => {
    expect(Value.Check(idParameterSchema, { id: 123 })).toBe(false);
  });
});
