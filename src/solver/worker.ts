import { PROGRESS_THROTTLE_MS, type MainToWorker, type WorkerToMain } from './protocol';
import { solveProblem } from './solve';

interface WorkerScope {
  postMessage(message: WorkerToMain): void;
  onmessage: ((event: MessageEvent<MainToWorker>) => void) | null;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  const message = event.data;
  if (message?.type !== 'solve') return;
  let lastPost = -Infinity;
  const result = solveProblem(message.problem, message.request, {
    progressInterval: 1024,
    onProgress: (progress) => {
      // Posting does not require the worker to yield; the main thread receives these while we search.
      if (progress.elapsedMs - lastPost >= PROGRESS_THROTTLE_MS) {
        lastPost = progress.elapsedMs;
        scope.postMessage({ type: 'progress', requestId: message.requestId, progress });
      }
    },
  });
  scope.postMessage({ type: 'result', requestId: message.requestId, result });
};
