import { registry } from '@isat/core';

export interface MethodCounts {
  available: number;
  notIncluded: number;
}

/** Derived from the engine: entries whose YAML spec carries a deferred/excluded reason are "not included". */
export function methodCounts(): MethodCounts {
  const notIncluded = registry.filter((m) => m.deferredReason !== undefined).length;
  return { available: registry.length - notIncluded, notIncluded };
}
