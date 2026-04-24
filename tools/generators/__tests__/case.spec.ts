import { describe, expect, it } from 'vitest';

import {
  toCamelCase,
  toKebabCase,
  toPascalCase,
  toSingular,
  toSnakeCase,
  toTitleCase,
} from '../src/util/case.ts';

describe('case conversion', () => {
  it.each([
    ['widgets', 'widgets'],
    ['BlogPosts', 'blog-posts'],
    ['merchant_mids', 'merchant-mids'],
    ['API Keys', 'api-keys'],
  ])('toKebabCase(%s) -> %s', (input, expected) => {
    expect(toKebabCase(input)).toBe(expected);
  });

  it.each([
    ['blog-posts', 'blogPosts'],
    ['BlogPosts', 'blogPosts'],
    ['merchant_mids', 'merchantMids'],
  ])('toCamelCase(%s) -> %s', (input, expected) => {
    expect(toCamelCase(input)).toBe(expected);
  });

  it.each([
    ['blog-posts', 'BlogPosts'],
    ['merchant_mids', 'MerchantMids'],
    ['api keys', 'ApiKeys'],
  ])('toPascalCase(%s) -> %s', (input, expected) => {
    expect(toPascalCase(input)).toBe(expected);
  });

  it.each([
    ['widgets', 'widgets'],
    ['blog-posts', 'blog_posts'],
  ])('toSnakeCase(%s) -> %s', (input, expected) => {
    expect(toSnakeCase(input)).toBe(expected);
  });

  it.each([
    ['blog-posts', 'Blog Posts'],
    ['widgets', 'Widgets'],
  ])('toTitleCase(%s) -> %s', (input, expected) => {
    expect(toTitleCase(input)).toBe(expected);
  });

  describe('toSingular', () => {
    it.each([
      ['widgets', 'widget'],
      ['categories', 'category'],
      ['addresses', 'address'],
      ['users', 'user'],
    ])('toSingular(%s) -> %s', (input, expected) => {
      expect(toSingular(input)).toBe(expected);
    });
  });
});
