// Stable editor state API; implementation is split by responsibility.
export type {
    EditMode,
    Doc,
    Notice,
    CanvasSelection,
    RunState,
    PlaybackState,
    EditorState,
    EditorAction,
} from "./types";
export { emptyDoc, createInitialState } from "./projectState";
export { editorReducer, cascadeNotice } from "./reducer";
export {
    docProblem,
    isLocked,
    isDirty,
    isResultStale,
    canUndo,
    canRedo,
    budgetUpperBound,
    toProjectFile,
} from "./selectors";
