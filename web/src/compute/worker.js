import { executeKernel } from './stats.js';

self.onmessage = event => {
  const { id, buffer, offset } = event.data;
  try {
    const result = executeKernel(new Uint32Array(buffer), { offset });
    self.postMessage({ id, buffer: result.values.buffer, sum: result.sum }, [result.values.buffer]);
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};
