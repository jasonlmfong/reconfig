import type { PropertyId } from '../domain/problem';
import { pathProperty } from './path';
import { treeProperty } from './tree';
import { cycleProperty } from './cycle';
import { forestProperty } from './forestProperty';
import type { GraphProperty } from './types';

export type { GraphProperty } from './types';
export { maxBudget } from './types';
export { pathProperty } from './path';
export { treeProperty } from './tree';
export { cycleProperty } from './cycle';
export { forestProperty } from './forestProperty';

export const PROPERTIES: Readonly<Record<PropertyId, GraphProperty>> = {
  path: pathProperty,
  tree: treeProperty,
  cycle: cycleProperty,
  forest: forestProperty,
};

export function getProperty(id: PropertyId): GraphProperty {
  return PROPERTIES[id];
}
