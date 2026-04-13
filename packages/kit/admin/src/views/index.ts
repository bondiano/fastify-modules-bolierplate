/**
 * Barrel for every view module. `plugin.ts` and the route handlers import
 * everything through this file so they never reach into widget internals.
 */
export { Layout, type LayoutProps } from './layout.js';
export { DataTable, formatCell, type DataTableProps } from './data-table.js';
export { Form, type FormProps } from './form.js';
export { Icon, type IconProps } from './icons.js';
export {
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
  type WidgetProps,
} from './widgets/index.js';
