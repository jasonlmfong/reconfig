import { explainTreeLike, isBoundedDegreeTree } from "./treeLike";
import type { GraphProperty } from "./types";

/** Non-empty simple path: connected, acyclic, every incident vertex has degree at most 2. */
export const pathProperty: GraphProperty = {
    id: "path",
    name: "Path",
    noun: "path",
    allowsEmpty: false,
    isValid: (mask, graph) => isBoundedDegreeTree(mask, graph, 2),
    explainInvalid: (mask, graph) => explainTreeLike(mask, graph, 2),
};
