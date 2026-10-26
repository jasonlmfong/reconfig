import { explainTreeLike, isBoundedDegreeTree } from "./treeLike";
import type { GraphProperty } from "./types";

/** Non-empty tree: connected and acyclic; host vertices not incident to selected edges are ignored. */
export const treeProperty: GraphProperty = {
    id: "tree",
    name: "Tree",
    noun: "tree",
    allowsEmpty: false,
    isValid: (mask, graph) =>
        isBoundedDegreeTree(mask, graph, Number.MAX_SAFE_INTEGER),
    explainInvalid: (mask, graph) =>
        explainTreeLike(mask, graph, Number.MAX_SAFE_INTEGER),
};
