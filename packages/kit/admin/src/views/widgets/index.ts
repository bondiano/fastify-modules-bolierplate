/**
 * Widget registry + dispatcher. `renderWidget` picks the right component
 * based on `FieldSpec.widget`; `form.ts` uses it for every field.
 */
import type { VNode } from 'preact';

import type { FieldSpec, WidgetKind } from '../../types.js';

import { AutocompleteInput } from './autocomplete.js';
import { CheckboxInput } from './checkbox.js';
import { DateInput } from './date.js';
import { DateTimeInput } from './datetime.js';
import { HiddenInput } from './hidden.js';
import { JsonInput } from './json.js';
import { NumberInput } from './number.js';
import { RadioGroup } from './radio-group.js';
import { ReadonlyField } from './readonly.js';
import { SelectInput } from './select.js';
import { TagsInput } from './tags.js';
import { TextInput, type WidgetProps } from './text.js';
import { Textarea } from './textarea.js';

export { TagsInput } from './tags.js';
export { Textarea } from './textarea.js';
export { TextInput, type WidgetProps } from './text.js';

const WIDGET_BY_KIND: Readonly<
  Record<WidgetKind, (props: WidgetProps) => VNode>
> = {
  text: TextInput,
  textarea: Textarea,
  number: NumberInput,
  checkbox: CheckboxInput,
  select: SelectInput,
  'radio-group': RadioGroup,
  date: DateInput,
  datetime: DateTimeInput,
  json: JsonInput,
  autocomplete: AutocompleteInput,
  hidden: HiddenInput,
  readonly: ReadonlyField,
  tags: TagsInput,
};

export const renderWidget = (
  field: FieldSpec,
  value: unknown,
  disabled = false,
  resourceName = '',
  displayValue?: unknown,
): VNode => {
  const component = WIDGET_BY_KIND[field.widget];
  return component({ field, value, disabled, resourceName, displayValue });
};

export { AutocompleteInput } from './autocomplete.js';
export { CheckboxInput } from './checkbox.js';
export { DateInput } from './date.js';
export { DateTimeInput } from './datetime.js';
export { HiddenInput } from './hidden.js';
export { JsonInput } from './json.js';
export { NumberInput } from './number.js';
export { RadioGroup } from './radio-group.js';
export { ReadonlyField } from './readonly.js';
export { SelectInput } from './select.js';
