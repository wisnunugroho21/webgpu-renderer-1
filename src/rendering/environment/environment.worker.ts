import { prepareEnvironment } from "./prepareEnvironment";
import type { EnvironmentWorkerScope } from "./EnvironmentWorkerProtocol";
import { transferableBuffers } from "../../assets/workers/transfer";
const scope = globalThis as unknown as EnvironmentWorkerScope;
scope.onmessage = async (event) => {
  const { id, bytes, options } = event.data;
  try {
    const start = performance.now(),
      prepared = await prepareEnvironment(bytes, options);
    scope.postMessage(
      { id, ...prepared, prepareMs: performance.now() - start },
      transferableBuffers(prepared.data),
    );
  } catch (error) {
    scope.postMessage({ id, error: String(error) });
  }
};
