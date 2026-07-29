import { expect, it } from 'vitest';

import { OperationCoordinator } from './operation-coordinator.js';

it('runs mutations in order and continues after a failed operation', async () => {
  const coordinator = new OperationCoordinator();
  const order: string[] = [];
  let releaseFirst: (() => void) | undefined;
  const first = coordinator.run(
    () =>
      new Promise<void>((resolve) => {
        order.push('first-start');
        releaseFirst = () => {
          order.push('first-end');
          resolve();
        };
      }),
  );
  const failed = coordinator.run(() => {
    order.push('failed');
    return Promise.reject(new Error('expected failure'));
  });
  const final = coordinator.run(() => {
    order.push('final');
    return Promise.resolve();
  });

  await Promise.resolve();
  expect(order).toEqual(['first-start']);
  releaseFirst?.();
  await first;
  await expect(failed).rejects.toThrow('expected failure');
  await final;
  expect(order).toEqual(['first-start', 'first-end', 'failed', 'final']);
});
