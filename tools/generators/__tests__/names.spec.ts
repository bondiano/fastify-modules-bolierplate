import { describe, expect, it } from 'vitest';

import { buildModuleNames } from '../src/util/names.ts';

describe('buildModuleNames', () => {
  it('derives plural + singular variants for a simple noun', () => {
    expect(buildModuleNames('widgets')).toEqual({
      plural: {
        kebab: 'widgets',
        camel: 'widgets',
        pascal: 'Widgets',
        title: 'Widgets',
      },
      singular: {
        kebab: 'widget',
        camel: 'widget',
        pascal: 'Widget',
        title: 'Widget',
      },
    });
  });

  it('handles multi-word kebab names', () => {
    const names = buildModuleNames('blog-posts');
    expect(names.plural.camel).toBe('blogPosts');
    expect(names.plural.pascal).toBe('BlogPosts');
    expect(names.singular.camel).toBe('blogPost');
    expect(names.singular.pascal).toBe('BlogPost');
  });
});
