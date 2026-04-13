import { describe, expect, it } from 'vitest';

import { renderFragment } from '../../render.js';
import { makeFieldSpec } from '../fixtures.js';

import {
  AutocompleteInput,
  CheckboxInput,
  DateInput,
  DateTimeInput,
  HiddenInput,
  JsonInput,
  NumberInput,
  RadioGroup,
  ReadonlyField,
  SelectInput,
  TagsInput,
  Textarea,
  TextInput,
  renderWidget,
} from './index.js';

describe('TextInput', () => {
  it('renders a text input with required + maxlength', () => {
    const out = renderFragment(
      TextInput({
        field: makeFieldSpec({ name: 'title', required: true, maxLength: 80 }),
        value: 'hi',
      }),
    );
    expect(out).toContain('type="text"');
    expect(out).toContain('name="title"');
    expect(out).toContain('value="hi"');
    expect(out).toContain('maxlength="80"');
    expect(out).toContain('required');
  });

  it('passes the readonly attribute through', () => {
    const out = renderFragment(
      TextInput({
        field: makeFieldSpec({ name: 'slug', readOnly: true }),
        value: 's',
      }),
    );
    expect(out).toContain('readonly');
  });
});

describe('Textarea', () => {
  it('renders a textarea with the value inside', () => {
    const out = renderFragment(
      Textarea({ field: makeFieldSpec({ name: 'body' }), value: 'hello' }),
    );
    expect(out).toContain('<textarea');
    expect(out).toContain('hello');
  });
});

describe('NumberInput', () => {
  it('renders type=number', () => {
    const out = renderFragment(
      NumberInput({
        field: makeFieldSpec({ name: 'n', widget: 'number' }),
        value: 42,
      }),
    );
    expect(out).toContain('type="number"');
    expect(out).toContain('value="42"');
  });
});

describe('CheckboxInput', () => {
  it('renders a checked checkbox with hidden false companion', () => {
    const out = renderFragment(
      CheckboxInput({
        field: makeFieldSpec({ name: 'ok', widget: 'checkbox' }),
        value: true,
      }),
    );
    expect(out).toContain('type="checkbox"');
    expect(out).toContain('checked');
    expect(out).toContain('type="hidden"');
  });
});

describe('SelectInput', () => {
  it('renders option tags from enumValues', () => {
    const out = renderFragment(
      SelectInput({
        field: makeFieldSpec({
          name: 'status',
          widget: 'select',
          enumValues: ['draft', 'published'],
          required: true,
        }),
        value: 'draft',
      }),
    );
    expect(out).toContain('<select');
    expect(out).toContain('<option value="draft"');
    expect(out).toContain('<option value="published"');
  });
});

describe('RadioGroup', () => {
  it('renders one input per enum value', () => {
    const out = renderFragment(
      RadioGroup({
        field: makeFieldSpec({
          name: 'status',
          widget: 'radio-group',
          enumValues: ['a', 'b'],
        }),
        value: 'b',
      }),
    );
    const count = out.match(/type="radio"/g)?.length ?? 0;
    expect(count).toBe(2);
    expect(out).toContain('value="b"');
  });
});

describe('DateInput / DateTimeInput', () => {
  it('date field renders type=date and slices ISO', () => {
    const out = renderFragment(
      DateInput({
        field: makeFieldSpec({ name: 'd', widget: 'date' }),
        value: '2024-05-06T11:12:13.000Z',
      }),
    );
    expect(out).toContain('type="date"');
    expect(out).toContain('value="2024-05-06"');
  });

  it('datetime field renders type=datetime-local and YYYY-MM-DDTHH:mm', () => {
    const out = renderFragment(
      DateTimeInput({
        field: makeFieldSpec({ name: 'd', widget: 'datetime' }),
        value: '2024-05-06T11:12:13.000Z',
      }),
    );
    expect(out).toContain('type="datetime-local"');
    expect(out).toContain('value="2024-05-06T11:12"');
  });
});

describe('JsonInput', () => {
  it('renders pretty JSON into a textarea', () => {
    const out = renderFragment(
      JsonInput({
        field: makeFieldSpec({ name: 'j', widget: 'json' }),
        value: { a: 1 },
      }),
    );
    expect(out).toContain('<textarea');
    expect(out).toContain('&quot;a&quot;');
  });
});

describe('AutocompleteInput', () => {
  it('renders a hidden input + visible hx-get input', () => {
    const out = renderFragment(
      AutocompleteInput({
        field: makeFieldSpec({
          name: 'authorId',
          widget: 'autocomplete',
          references: { table: 'users', column: 'id' },
        }),
        value: 'u1',
        resourceName: 'posts',
      }),
    );
    expect(out).toContain('type="hidden"');
    expect(out).toContain('hx-get="/admin/posts/_relations/authorId"');
  });
});

describe('HiddenInput', () => {
  it('renders a plain hidden input', () => {
    const out = renderFragment(
      HiddenInput({
        field: makeFieldSpec({ name: 'secret', widget: 'hidden' }),
        value: 'x',
      }),
    );
    expect(out).toContain('type="hidden"');
    expect(out).toContain('value="x"');
  });
});

describe('ReadonlyField', () => {
  it('renders the value + a round-trip hidden input', () => {
    const out = renderFragment(
      ReadonlyField({
        field: makeFieldSpec({ name: 'id', widget: 'readonly' }),
        value: '123',
      }),
    );
    expect(out).toContain('form-readonly');
    expect(out).toContain('123');
    expect(out).toContain('type="hidden"');
  });
});

describe('TagsInput', () => {
  it('joins an array with commas', () => {
    const out = renderFragment(
      TagsInput({
        field: makeFieldSpec({ name: 'tags', widget: 'tags' }),
        value: ['a', 'b', 'c'],
      }),
    );
    expect(out).toContain('value="a, b, c"');
  });
});

describe('renderWidget dispatcher', () => {
  it('picks the right widget for each kind', () => {
    const field = makeFieldSpec({ name: 'n', widget: 'number' });
    const out = renderFragment(renderWidget(field, 5));
    expect(out).toContain('type="number"');
  });
});
