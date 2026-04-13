/**
 * Public entry for the discovery sub-package: cradle walking, widget
 * inference, spec inference, and override merging. Consumed by the
 * plugin factory during boot to build the `AdminRegistry`.
 */
export { walkCradle } from './walk-cradle.js';
export type { WalkCradleOptions } from './walk-cradle.js';

export { inferWidget } from './infer-widget.js';

export { inferSpec } from './infer-spec.js';
export type { InferSpecOptions, AutogenValidators } from './infer-spec.js';

export { mergeOverrides } from './merge-overrides.js';
