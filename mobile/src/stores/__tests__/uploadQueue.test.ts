import { uploadMediaFile } from '@/api/uploads';
import {
  awaitBatch,
  cancelBatch,
  clearBatch,
  enqueueUploads,
  removeUpload,
  resetUploadQueueForTests,
  retryBatch,
  selectBatch,
  summarizeUploads,
  useUploadQueue,
} from '@/stores/uploadQueue';

jest.mock('@/api/uploads', () => ({
  uploadMediaFile: jest.fn(),
}));

const mockUpload = uploadMediaFile as jest.MockedFunction<typeof uploadMediaFile>;

function file(name: string) {
  return { uri: `file:///${name}`, name, type: 'image/jpeg' };
}

/** A promise plus the handles to settle it, so a test can hold uploads open
 * and assert on the queue mid-flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise<void>((resolve) => setImmediate(() => resolve()));

beforeEach(() => {
  resetUploadQueueForTests();
  mockUpload.mockReset();
});

describe('upload queue', () => {
  it('uploads every file and returns the batch in the order it was enqueued', async () => {
    // Resolve out of order to prove ordering comes from the queue, not from
    // whichever upload happens to finish first.
    mockUpload.mockImplementation(async (f) => {
      if (f.name === 'a.jpg') await flush();
      return `/uploads/${f.name}`;
    });

    const batchId = enqueueUploads([file('a.jpg'), file('b.jpg')]);
    const settled = await awaitBatch(batchId);

    expect(settled.map((item) => item.file.name)).toEqual(['a.jpg', 'b.jpg']);
    expect(settled.map((item) => item.url)).toEqual(['/uploads/a.jpg', '/uploads/b.jpg']);
    expect(settled.every((item) => item.status === 'done')).toBe(true);
  });

  it('never runs more than three uploads at once', async () => {
    const gate = deferred<string>();
    mockUpload.mockImplementation(() => gate.promise);

    enqueueUploads([file('1.jpg'), file('2.jpg'), file('3.jpg'), file('4.jpg'), file('5.jpg')]);

    expect(mockUpload).toHaveBeenCalledTimes(3);

    gate.resolve('/uploads/done.jpg');
    await flush();
    expect(mockUpload).toHaveBeenCalledTimes(5);
  });

  it('keeps the successful files when one of them fails', async () => {
    mockUpload.mockImplementation(async (f) => {
      if (f.name === 'bad.jpg') throw new Error('boom');
      return `/uploads/${f.name}`;
    });

    const batchId = enqueueUploads([file('good.jpg'), file('bad.jpg')]);
    const settled = await awaitBatch(batchId);

    const summary = summarizeUploads(settled);
    expect(summary).toMatchObject({ total: 2, done: 1, failed: 1, inFlight: 0, allSettled: true });
    expect(settled.find((item) => item.file.name === 'bad.jpg')?.error).toBe('boom');
    expect(settled.find((item) => item.file.name === 'good.jpg')?.url).toBe('/uploads/good.jpg');
  });

  it('retries only the failed files', async () => {
    mockUpload
      .mockImplementationOnce(async (f) => `/uploads/${f.name}`)
      .mockImplementationOnce(async () => {
        throw new Error('boom');
      })
      .mockImplementation(async (f) => `/uploads/${f.name}`);

    const batchId = enqueueUploads([file('good.jpg'), file('flaky.jpg')]);
    await awaitBatch(batchId);
    expect(mockUpload).toHaveBeenCalledTimes(2);

    retryBatch(batchId);
    const settled = await awaitBatch(batchId);

    // Only the failed file was re-sent — three calls total, not four.
    expect(mockUpload).toHaveBeenCalledTimes(3);
    expect(settled.every((item) => item.status === 'done')).toBe(true);
  });

  it('cancels in-flight and pending uploads', async () => {
    const gate = deferred<string>();
    mockUpload.mockImplementation(() => gate.promise);

    const batchId = enqueueUploads([file('1.jpg'), file('2.jpg'), file('3.jpg'), file('4.jpg')]);
    cancelBatch(batchId);

    const items = selectBatch(useUploadQueue.getState().items, batchId);
    expect(items.every((item) => item.status === 'canceled')).toBe(true);
    // A cancelled batch counts as settled, so a caller awaiting it is not
    // left hanging.
    await expect(awaitBatch(batchId)).resolves.toHaveLength(4);
  });

  it('removes a single upload from the queue', async () => {
    mockUpload.mockImplementation(async (f) => `/uploads/${f.name}`);

    const batchId = enqueueUploads([file('a.jpg'), file('b.jpg')]);
    await awaitBatch(batchId);

    const first = selectBatch(useUploadQueue.getState().items, batchId)[0];
    removeUpload(first.id);

    const remaining = selectBatch(useUploadQueue.getState().items, batchId);
    expect(remaining.map((item) => item.file.name)).toEqual(['b.jpg']);
  });

  it('clears a batch once its urls have been taken', async () => {
    mockUpload.mockImplementation(async (f) => `/uploads/${f.name}`);

    const batchId = enqueueUploads([file('a.jpg')]);
    await awaitBatch(batchId);
    clearBatch(batchId);

    expect(selectBatch(useUploadQueue.getState().items, batchId)).toHaveLength(0);
  });
});
