import { describe, expect, it } from 'vitest';

import { walkCradle } from './walk-cradle.js';

const makeRepo = (table: string): Record<string, unknown> => ({
  table,
  findPaginatedByPage: async () => ({ items: [], total: 0 }),
  findById: async () => {},
  create: async (data: unknown) => data,
  update: async (_id: string, data: unknown) => data,
  deleteById: async () => {},
});

describe('walkCradle', () => {
  it('picks up every *Repository entry that quacks like a repo', () => {
    const cradle: Record<string, unknown> = {
      postsRepository: makeRepo('posts'),
      usersRepository: makeRepo('users'),
      mailer: { send: () => {} },
    };
    const found = walkCradle({ cradle });
    expect(found.map((f) => f.repositoryKey)).toEqual([
      'postsRepository',
      'usersRepository',
    ]);
    expect(found[0]!.repository.table).toBe('posts');
  });

  it('skips entries without the *Repository suffix', () => {
    const cradle = { posts: makeRepo('posts') };
    expect(walkCradle({ cradle })).toEqual([]);
  });

  it('skips entries that throw on access', () => {
    const cradle: Record<string, unknown> = {
      postsRepository: makeRepo('posts'),
    };
    Object.defineProperty(cradle, 'brokenRepository', {
      enumerable: true,
      get: () => {
        throw new Error('boom');
      },
    });
    const found = walkCradle({ cradle });
    expect(found.map((f) => f.repositoryKey)).toEqual(['postsRepository']);
  });

  it('skips entries missing required CRUD methods', () => {
    const cradle = {
      badRepository: { table: 'bad', findById: () => {} },
    };
    expect(walkCradle({ cradle })).toEqual([]);
  });

  it('applies includeTables filter', () => {
    const cradle = {
      postsRepository: makeRepo('posts'),
      usersRepository: makeRepo('users'),
    };
    const found = walkCradle({ cradle, includeTables: ['users'] });
    expect(found.map((f) => f.repository.table)).toEqual(['users']);
  });

  it('applies excludeTables filter', () => {
    const cradle = {
      postsRepository: makeRepo('posts'),
      usersRepository: makeRepo('users'),
    };
    const found = walkCradle({ cradle, excludeTables: ['users'] });
    expect(found.map((f) => f.repository.table)).toEqual(['posts']);
  });

  it('returns results sorted by repositoryKey ascending', () => {
    const cradle = {
      zRepository: makeRepo('z'),
      aRepository: makeRepo('a'),
      mRepository: makeRepo('m'),
    };
    const found = walkCradle({ cradle });
    expect(found.map((f) => f.repositoryKey)).toEqual([
      'aRepository',
      'mRepository',
      'zRepository',
    ]);
  });
});
