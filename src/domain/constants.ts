/** Current graph size caps, raised after MVP benchmarking. */
export const MAX_VERTICES = 12;
export const MAX_EDGES = 22;

/**
 * Hard ceiling for a host's edge count. Bitwise operators allow 30 bits, but each search pass
 * needs about 8 · 2^m bytes, so 24 bits (~150 MB) is the practical limit.
 */
export const MASK_BIT_LIMIT = 24;

export const SOLVER_VERSION = "0.2.0";
export const SCHEMA_VERSION = 1;

/** Upper bound on the size of an imported project file. */
export const MAX_IMPORT_BYTES = 256 * 1024;
export const MAX_LABEL_LENGTH = 40;
export const MAX_ID_LENGTH = 64;
export const MAX_PROJECT_NAME_LENGTH = 120;

export interface GraphLimits {
    maxVertices: number;
    maxEdges: number;
}

export const DEFAULT_LIMITS: GraphLimits = {
    maxVertices: MAX_VERTICES,
    maxEdges: MAX_EDGES,
};

if (MAX_EDGES > MASK_BIT_LIMIT) {
    throw new Error(
        `MAX_EDGES (${MAX_EDGES}) exceeds the ${MASK_BIT_LIMIT}-bit mask representation.`
    );
}
