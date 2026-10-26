import { DEFAULT_LIMITS, type GraphLimits } from "../domain/constants";
import { indexGraph } from "../domain/graph";
import { maskFromEdgeIds } from "../domain/mask";
import type { Problem, SelectionRole } from "../domain/problem";
import type { ValidationIssue } from "../domain/result";
import { PROPERTIES, type GraphProperty } from "../properties";
import { MOVE_MODELS } from "../moveModels";
import { validateGraphStructure } from "./graphValidation";
import { messages } from "./messages";

export interface RoleCheck {
    size: number;
    /** True when the selection is non-empty, well-formed, and satisfies the property. */
    valid: boolean;
    /** Explanation when invalid (null when valid or when the only problem is emptiness). */
    message: string | null;
}

export interface ProblemCheck {
    graphIssues: ValidationIssue[];
    source: RoleCheck;
    target: RoleCheck;
    sizeMessage: string | null;
    emptyMessage: string | null;
    /** Every blocking issue, with field paths. */
    issues: ValidationIssue[];
    canSolve: boolean;
    /** Source size. */
    q: number;
}

/** Live validation of a problem. Solving is allowed only when `canSolve` is true. */
export function validateProblem(
    problem: Problem,
    limits: GraphLimits = DEFAULT_LIMITS,
    propertyOverride?: GraphProperty
): ProblemCheck {
    const graphIssues = validateGraphStructure(problem.graph, limits);
    const property =
        propertyOverride ??
        (Object.hasOwn(PROPERTIES, problem.property)
            ? PROPERTIES[problem.property]
            : undefined);
    const issues: ValidationIssue[] = [...graphIssues];
    if (!property) {
        issues.push({
            field: "property",
            message: `Unknown property ${String(problem.property)}.`,
        });
    }
    if (!Object.hasOwn(MOVE_MODELS, problem.moveModel ?? "token-jumping")) {
        issues.push({
            field: "moveModel",
            message: `Unknown move model ${String(problem.moveModel)}.`,
        });
    }

    const graphUsable = graphIssues.length === 0;
    const indexed = graphUsable ? indexGraph(problem.graph) : null;

    const checkRole = (role: SelectionRole, ids: string[]): RoleCheck => {
        const size = new Set(ids).size;
        const seen = new Set<string>();
        for (const id of ids) {
            if (seen.has(id)) {
                const message = `${role === "source" ? "Source" : "Target"} lists edge ${id} more than once.`;
                issues.push({ field: role, message });
                return { size, valid: false, message };
            }
            seen.add(id);
            if (!problem.graph.edges.some((e) => e.id === id)) {
                const message = `${role === "source" ? "Source" : "Target"} references unknown edge ${id}.`;
                issues.push({ field: role, message });
                return { size, valid: false, message };
            }
        }
        if (size === 0) return { size, valid: false, message: null };
        if (!indexed || !property) return { size, valid: false, message: null };
        const mask = maskFromEdgeIds(ids, indexed);
        // The search uses isValid; never let a selection through that it would reject.
        const reason =
            property.explainInvalid(mask, indexed) ??
            (property.isValid(mask, indexed)
                ? null
                : "the solver rejects this selection");
        if (reason !== null) {
            const message = messages.invalidConfiguration(
                role,
                property.noun,
                reason
            );
            issues.push({ field: role, message });
            return { size, valid: false, message };
        }
        return { size, valid: true, message: null };
    };

    const source = checkRole("source", problem.sourceEdgeIds);
    const target = checkRole("target", problem.targetEdgeIds);

    let emptyMessage: string | null = null;
    if (source.size === 0 && target.size === 0)
        emptyMessage = messages.selectBoth();
    else if (source.size === 0) emptyMessage = messages.selectOne("source");
    else if (target.size === 0) emptyMessage = messages.selectOne("target");
    if (emptyMessage)
        issues.push({ field: "selection", message: emptyMessage });

    let sizeMessage: string | null = null;
    if (source.size > 0 && target.size > 0 && source.size !== target.size) {
        sizeMessage = messages.sizeMismatch(source.size, target.size);
        issues.push({ field: "selection", message: sizeMessage });
    }

    return {
        graphIssues,
        source,
        target,
        sizeMessage,
        emptyMessage,
        issues,
        canSolve: issues.length === 0 && source.valid && target.valid,
        q: source.size,
    };
}
