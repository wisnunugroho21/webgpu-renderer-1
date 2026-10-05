import { transferableBuffers } from "./workers/transfer";
/** Cold-path byte snapshot of distinct retained ArrayBuffer backing stores; aliased views count once.
 * Object/string/driver overhead and temporary decode allocations are outside this payload estimate. */
export function retainedMemory(...sources: unknown[]): number {
  let bytes = 0;
  for (const buffer of transferableBuffers(sources)) bytes += buffer.byteLength;
  return bytes;
}
