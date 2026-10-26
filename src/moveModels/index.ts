import type { MoveModelId } from '../domain/moveModel';
import type { MoveModel } from './types';

export type { MoveModel } from './types';

export const tokenJumpingModel: MoveModel = {
  id: 'token-jumping',
  name: 'Token Jumping + extra buffer',
  description: 'A token may move to any unselected host edge; tokens may also be stored and retrieved using the buffer.',
  canReplace: () => true,
};

export const tokenSlidingModel: MoveModel = {
  id: 'token-sliding',
  name: 'Token Sliding + extra buffer',
  description: 'A token may move only to an unselected edge sharing an endpoint; tokens may also be stored and retrieved using the buffer.',
  canReplace: (removed, added, graph) => {
    const u = graph.edgeU[removed];
    const v = graph.edgeV[removed];
    return u === graph.edgeU[added] || u === graph.edgeV[added] || v === graph.edgeU[added] || v === graph.edgeV[added];
  },
};

export const MOVE_MODELS: Readonly<Record<MoveModelId, MoveModel>> = {
  'token-jumping': tokenJumpingModel,
  'token-sliding': tokenSlidingModel,
};
