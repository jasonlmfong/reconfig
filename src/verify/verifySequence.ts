import { indexGraph } from "../domain/graph";
import type { Problem, PropertyId } from "../domain/problem";
import type { SolverResult } from "../domain/result";
import { maxBudget, PROPERTIES, type GraphProperty } from "../properties";
import { MOVE_MODELS } from "../moveModels";

export interface VerificationReport {
    ok: boolean;
    errors: string[];
}

type Ends = ReadonlyMap<string, readonly [string, string]>;

/**
 * Independent replay checker (§7). It works on edge-ID sets and shares no validity or move
 * logic with the search: property membership and sliding adjacency are recomputed here from
 * vertex IDs rather than via `GraphProperty.isValid` or `MoveModel.canReplace`. It confirms the
 * sequence starts at the source, ends at the target, uses only legal moves for the problem's
 * model, keeps every configuration valid and within q - b <= |F| <= q, and reports consistent
 * buffer occupancy and step metadata. Non-reachable results carry no sequence and pass trivially.
 * `propertyOverride` (tests only) replaces the independent property check with the given one.
 */
export function verifySequence(
    problem: Problem,
    result: SolverResult,
    propertyOverride?: GraphProperty
): VerificationReport {
    if (result.status !== "reachable") return { ok: true, errors: [] };
    const errors: string[] = [];
    const property =
        propertyOverride ??
        (Object.hasOwn(PROPERTIES, problem.property)
            ? PROPERTIES[problem.property]
            : undefined);
    const modelId = problem.moveModel ?? "token-jumping";
    const moveModel = Object.hasOwn(MOVE_MODELS, modelId)
        ? MOVE_MODELS[modelId]
        : undefined;
    if (!property)
        return { ok: false, errors: [`unknown property ${problem.property}`] };
    if (!moveModel)
        return {
            ok: false,
            errors: [`unknown move model ${problem.moveModel}`],
        };
    if (result.property !== property.id) {
        errors.push(
            `result property ${result.property} does not match problem property ${property.id}`
        );
    }
    if (result.moveModel !== undefined && result.moveModel !== moveModel.id) {
        errors.push(
            `result move model ${result.moveModel} does not match problem move model ${moveModel.id}`
        );
    }

    const hostEdges = new Set(problem.graph.edges.map((e) => e.id));
    const source = new Set(problem.sourceEdgeIds);
    const target = new Set(problem.targetEdgeIds);
    const q = source.size;
    if (target.size !== q)
        errors.push(`source size ${q} differs from target size ${target.size}`);
    if (result.sourceSize !== q)
        errors.push(
            `reported sourceSize ${result.sourceSize} but source has ${q} edges`
        );
    if (result.targetSize !== target.size)
        errors.push(
            `reported targetSize ${result.targetSize} but target has ${target.size} edges`
        );

    const b = result.budget;
    const upper = maxBudget(property, q);
    if (!Number.isInteger(b) || b < 0 || b > upper)
        errors.push(`budget ${b} is outside 0..${upper}`);
    if (result.isMinimum && result.mode !== "find-minimum")
        errors.push("isMinimum is only valid in find-minimum mode");

    const steps = result.steps;
    if (!Array.isArray(steps) || steps.length === 0) {
        errors.push("sequence is empty");
        return { ok: false, errors };
    }
    if (result.moveCount !== steps.length - 1) {
        errors.push(
            `moveCount ${result.moveCount} does not equal steps.length - 1 (${steps.length - 1})`
        );
    }

    const ends: Ends = new Map(
        problem.graph.edges.map((e) => [e.id, [e.u, e.v] as const])
    );
    let isValid: (ids: Set<string>) => boolean;
    if (propertyOverride) {
        let indexed: ReturnType<typeof indexGraph>;
        try {
            indexed = indexGraph(problem.graph);
        } catch (err) {
            return {
                ok: false,
                errors: [
                    ...errors,
                    `host graph cannot be indexed: ${String(err)}`,
                ],
            };
        }
        isValid = (ids) => {
            let mask = 0;
            for (const id of ids) {
                const bit = indexed.edgeIndex.get(id);
                if (bit !== undefined) mask |= 1 << bit;
            }
            return propertyOverride.isValid(mask, indexed);
        };
    } else {
        isValid = (ids) => satisfiesProperty(problem.property, ids, ends);
    }

    let prev: Set<string> | null = null;
    steps.forEach((step, i) => {
        const where = `step ${i + 1}`;
        if (step.index !== i + 1)
            errors.push(`${where}: index is ${step.index}, expected ${i + 1}`);
        const ids = step.configurationEdgeIds;
        const current = new Set(ids);
        if (current.size !== ids.length)
            errors.push(`${where}: configuration lists an edge more than once`);
        for (const id of current) {
            if (!hostEdges.has(id))
                errors.push(`${where}: edge ${id} is not a host edge`);
        }
        if (current.size < q - b || current.size > q) {
            errors.push(
                `${where}: configuration size ${current.size} is outside ${q - b}..${q}`
            );
        }
        if (step.bufferOccupancy !== q - current.size) {
            errors.push(
                `${where}: buffer occupancy ${step.bufferOccupancy}, expected ${q - current.size}`
            );
        }
        if (!isValid(current))
            errors.push(
                `${where}: configuration is not a valid ${property.noun}`
            );

        if (prev === null) {
            if (step.moveType !== "initial")
                errors.push(`${where}: first step must be 'initial'`);
            if (
                step.removedEdgeId !== undefined ||
                step.addedEdgeId !== undefined
            ) {
                errors.push(
                    `${where}: initial step must not name changed edges`
                );
            }
            if (!sameSet(current, source))
                errors.push(`${where}: sequence does not start at the source`);
        } else {
            const removed = [...prev].filter((id) => !current.has(id));
            const added = [...current].filter((id) => !prev!.has(id));
            const expect = (r: number, a: number) =>
                removed.length === r && added.length === a;
            switch (step.moveType) {
                case "token-jump":
                    if (!expect(1, 1))
                        errors.push(
                            `${where}: token jump must remove one edge and add one edge`
                        );
                    else if (
                        step.removedEdgeId !== removed[0] ||
                        step.addedEdgeId !== added[0]
                    ) {
                        errors.push(
                            `${where}: token jump names the wrong edges`
                        );
                    } else if (moveModel.id !== "token-jumping")
                        errors.push(
                            `${where}: token jump is not allowed by ${moveModel.name}`
                        );
                    break;
                case "token-slide":
                    if (!expect(1, 1))
                        errors.push(
                            `${where}: token slide must remove one edge and add one edge`
                        );
                    else if (
                        step.removedEdgeId !== removed[0] ||
                        step.addedEdgeId !== added[0]
                    )
                        errors.push(
                            `${where}: token slide names the wrong edges`
                        );
                    else if (
                        moveModel.id !== "token-sliding" ||
                        !shareEndpoint(removed[0], added[0], ends)
                    ) {
                        errors.push(
                            `${where}: token slide does not use adjacent edges under the selected move model`
                        );
                    }
                    break;
                case "buffer-store":
                    if (!expect(1, 0))
                        errors.push(
                            `${where}: buffer store must remove exactly one edge`
                        );
                    else if (
                        step.removedEdgeId !== removed[0] ||
                        step.addedEdgeId !== undefined
                    ) {
                        errors.push(
                            `${where}: buffer store names the wrong edge`
                        );
                    }
                    break;
                case "buffer-retrieve":
                    if (!expect(0, 1))
                        errors.push(
                            `${where}: buffer retrieve must add exactly one edge`
                        );
                    else if (
                        step.addedEdgeId !== added[0] ||
                        step.removedEdgeId !== undefined
                    ) {
                        errors.push(
                            `${where}: buffer retrieve names the wrong edge`
                        );
                    }
                    if (prev.size >= q)
                        errors.push(
                            `${where}: retrieve requires fewer than ${q} selected edges`
                        );
                    break;
                default:
                    errors.push(
                        `${where}: illegal move type ${String(step.moveType)}`
                    );
            }
        }
        prev = current;
    });

    const last = new Set(steps[steps.length - 1].configurationEdgeIds);
    if (!sameSet(last, target))
        errors.push("sequence does not end at the target");

    return { ok: errors.length === 0, errors };
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
    if (a.size !== b.size) return false;
    for (const x of a) if (!b.has(x)) return false;
    return true;
}

function shareEndpoint(a: string, b: string, ends: Ends): boolean {
    const ea = ends.get(a);
    const eb = ends.get(b);
    return (
        ea !== undefined && eb !== undefined && ea.some((x) => eb.includes(x))
    );
}

/** Property membership from vertex degrees and component counts; unknown edge IDs are reported elsewhere. */
function satisfiesProperty(
    property: PropertyId,
    ids: Set<string>,
    ends: Ends
): boolean {
    const adjacency = new Map<string, string[]>();
    let edges = 0;
    for (const id of ids) {
        const e = ends.get(id);
        if (!e) continue;
        edges++;
        for (const [x, y] of [e, [e[1], e[0]]] as const) {
            const list = adjacency.get(x);
            if (list) list.push(y);
            else adjacency.set(x, [y]);
        }
    }
    if (edges === 0) return false;
    const vertices = adjacency.size;
    const seen = new Set<string>();
    let components = 0;
    for (const start of adjacency.keys()) {
        if (seen.has(start)) continue;
        components++;
        const stack = [start];
        seen.add(start);
        while (stack.length > 0) {
            for (const y of adjacency.get(stack.pop()!)!) {
                if (!seen.has(y)) {
                    seen.add(y);
                    stack.push(y);
                }
            }
        }
    }
    const degrees = [...adjacency.values()].map((list) => list.length);
    const acyclic = edges === vertices - components;
    switch (property) {
        case "forest":
            return acyclic;
        case "tree":
            return acyclic && components === 1;
        case "path":
            return acyclic && components === 1 && degrees.every((d) => d <= 2);
        case "cycle":
            return (
                components === 1 && edges >= 3 && degrees.every((d) => d === 2)
            );
        default:
            return false;
    }
}
