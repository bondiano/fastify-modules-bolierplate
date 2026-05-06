import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { _resetTemplateRegistry, defineTemplate } from './registry.js';
import { interpolate, renderTemplate, _resetRenderCache } from './render.js';

declare global {
  interface MailTemplates {
    'unit-test-template': {
      readonly name: string;
      readonly url: string;
      readonly raw: string;
    };
  }
}

describe('interpolate', () => {
  it('substitutes a Handlebars-style variable', () => {
    expect(interpolate('Hi {{name}}', { name: 'Alex' })).toBe('Hi Alex');
  });

  it('HTML-escapes by default', () => {
    expect(
      interpolate('<p>{{value}}</p>', { value: '<script>x</script>' }),
    ).toBe('<p>&lt;script&gt;x&lt;/script&gt;</p>');
  });

  it('skips escape when caller opts out (plain-text path)', () => {
    expect(
      interpolate('{{value}}', { value: '<a&b>' }, { escape: false }),
    ).toBe('<a&b>');
  });

  it('returns empty string for missing keys', () => {
    expect(interpolate('Hi {{name}}', {})).toBe('Hi ');
  });

  it('looks up nested paths', () => {
    expect(interpolate('Hi {{user.name}}', { user: { name: 'Alex' } })).toBe(
      'Hi Alex',
    );
  });
});

describe('renderTemplate', () => {
  beforeEach(() => {
    _resetTemplateRegistry();
    _resetRenderCache();
  });
  afterEach(() => {
    _resetTemplateRegistry();
    _resetRenderCache();
  });

  it('throws MailerNotConfigured for an unregistered template', async () => {
    await expect(
      renderTemplate('unit-test-template' as never, {
        to: 'a@b.com',
        payload: { name: 'X', url: 'https://x', raw: '' },
      }),
    ).rejects.toThrow(/Template "unit-test-template" is not registered/);
  });

  it('throws MailerNotConfigured when the compiled template is missing', async () => {
    defineTemplate('unit-test-template', {
      subject: 'Hi {{name}}',
      tags: [],
      previewFixture: {
        to: 'preview@example.com',
        payload: { name: 'Preview', url: 'https://x', raw: '' },
      },
    });
    await expect(
      renderTemplate('unit-test-template' as never, {
        to: 'a@b.com',
        payload: { name: 'X', url: 'https://x', raw: '' },
      }),
    ).rejects.toThrow(/Compiled template not found/);
  });
});
