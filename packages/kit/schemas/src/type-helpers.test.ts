import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';

import {
  DateTimeString,
  EmailString,
  StringEnum,
  UuidString,
} from './type-helpers.js';

describe('StringEnum', () => {
  const schema = StringEnum(['active', 'inactive', 'pending']);

  it('accepts valid enum value', () => {
    expect(Value.Check(schema, 'active')).toBe(true);
    expect(Value.Check(schema, 'inactive')).toBe(true);
  });

  it('rejects invalid value', () => {
    expect(Value.Check(schema, 'unknown')).toBe(false);
  });

  it('rejects non-string', () => {
    expect(Value.Check(schema, 42)).toBe(false);
  });
});

describe('DateTimeString', () => {
  it('produces a string schema with date-time format', () => {
    const schema = DateTimeString({ description: 'Created at' });
    expect(schema.type).toBe('string');
    expect(schema.format).toBe('date-time');
    expect(schema.description).toBe('Created at');
  });
});

describe('UuidString', () => {
  it('produces a string schema with uuid format', () => {
    const schema = UuidString({ description: 'Resource ID' });
    expect(schema.type).toBe('string');
    expect(schema.format).toBe('uuid');
    expect(schema.description).toBe('Resource ID');
  });
});

describe('EmailString', () => {
  it('produces a string schema with email format', () => {
    const schema = EmailString();
    expect(schema.type).toBe('string');
    expect(schema.format).toBe('email');
  });
});
