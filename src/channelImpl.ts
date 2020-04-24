import { Channel, closed, IterablePromise } from './channel';
import { Queue } from './queue';
import { ChannelClosedError, ChannelOverflowError } from './error';

/**
 * @hidden
 */
type ChannelMessage<T> = T extends Channel<infer U> ? U : never;

/**
 * @hidden
 */
type SelectResult<TChannels extends Record<string, Channel<any>>> = {
  [TKey in keyof TChannels]: {
    key: TKey;
    value: TakeValue<ChannelMessage<TChannels[TKey]>>;
  };
}[keyof TChannels];

/**
 * @hidden
 */
type SelectIteratorResult<TChannels extends Record<string, Channel<any>>> = {
  [TKey in keyof TChannels]: {
    key: TKey;
    value: ChannelMessage<TChannels[TKey]>;
  };
}[keyof TChannels];

/**
 * @hidden
 */
export type TakeValue<T> = T | closed;

const resolvedTrue = Promise.resolve(true);

const kBufferSize = Symbol('Channel#bufferSize');
const kClosed = Symbol('Channel#closed');
const kMessageQueue = Symbol('Channel#messageQueue');
const kReadQueue = Symbol('Channel#readQueue');
const kRead = Symbol('Channel#read');
const kSelect = Symbol('Channel.select');
const kTake = Symbol('Channel#take');

let totalOrder = 0;

export class ChannelImpl<T> implements Channel<T> {
  private [kBufferSize]: number;
  private [kClosed] = false;

  /** @hidden */
  readonly [kMessageQueue] = new Queue<{ msg: T; putCb?: (didPut: boolean) => void; ts: number }>();
  /** @hidden */
  readonly [kReadQueue] = new Queue<(msg: TakeValue<T>) => void>();

  constructor(bufferSize = 0) {
    this[kBufferSize] = bufferSize;
  }

  get closed() {
    return this[kClosed];
  }

  get size() {
    return this[kMessageQueue].size;
  }

  async *[Symbol.asyncIterator]() {
    while (true) {
      const value = await this.take();

      if (value === closed) {
        return;
      }

      yield value;
    }
  }

  close() {
    if (this[kClosed]) {
      throw new ChannelClosedError();
    }

    this[kClosed] = true;

    while (this[kReadQueue].size) {
      const reader = this[kReadQueue].pop()!;

      reader(closed);
    }

    while (this[kMessageQueue].size) {
      const { putCb } = this[kMessageQueue].pop()!;

      if (putCb) {
        putCb(false);
      }
    }
  }

  put(msg: T): Promise<boolean> {
    if (this[kClosed]) {
      throw new ChannelClosedError();
    }

    const ts = totalOrder++;
    const reader = this[kReadQueue].pop();

    if (reader) {
      reader(msg);

      return resolvedTrue;
    }

    return new Promise((resolve) => {
      if (!this[kMessageQueue].push({ msg, putCb: resolve, ts })) {
        // The internal message queue is full
        return resolve(false);
      }

      if (this[kMessageQueue].size <= this[kBufferSize]) {
        resolve(true);
      }
    });
  }

  private [kRead](): T | undefined {
    if (this[kClosed]) {
      return;
    }

    const pendingMsg = this[kMessageQueue].pop();
    if (!pendingMsg) {
      return;
    }

    if (pendingMsg.putCb) {
      pendingMsg.putCb(true);
    }

    return pendingMsg.msg;
  }

  take(): IterablePromise<TakeValue<T>, T> {
    const took = this[kTake]();
    const self = this;

    return Object.assign(isPromise(took) ? took : Promise.resolve(took), {
      async *[Symbol.asyncIterator]() {
        const result = isPromise(took) ? await took : took;

        if (result === closed) {
          return;
        }

        yield result;

        while (true) {
          const took = self[kTake]();
          const result = isPromise(took) ? await took : took;

          if (result === closed) {
            return;
          }

          yield result;
        }
      },
    });
  }

  private [kTake](): TakeValue<T> | (Promise<TakeValue<T>> & { dispose(): void }) {
    if (this[kClosed]) {
      return closed;
    }

    if (this.size) {
      return this[kRead]()!;
    }

    let dispose: (() => void) | false;
    const promise = new Promise<TakeValue<T>>((resolve) => {
      dispose = this[kReadQueue].push(resolve);

      if (!dispose) {
        return resolve(Promise.reject(new ChannelOverflowError()));
      }
    });

    return Object.assign(promise, { dispose: dispose! as () => void });
  }

  static select<TChannels extends { [key: string]: Channel<any> }>(
    chs: TChannels
  ): IterablePromise<SelectResult<TChannels>, SelectIteratorResult<TChannels>> {
    const typedChs = (chs as unknown) as { [key: string]: ChannelImpl<any> };
    const selectResult = this[kSelect](typedChs);

    return Object.assign(isPromise(selectResult) ? selectResult : Promise.resolve(selectResult), {
      async *[Symbol.asyncIterator]() {
        const result = isPromise(selectResult) ? await selectResult : selectResult;

        if (result.value === closed) {
          return;
        }

        yield result as SelectIteratorResult<TChannels>;

        while (true) {
          const selectResult = ChannelImpl[kSelect](typedChs);
          const result = isPromise(selectResult) ? await selectResult : selectResult;

          if (result.value === closed) {
            return;
          }

          yield result as SelectIteratorResult<TChannels>;
        }
      },
    });
  }

  private static [kSelect]<TChannels extends Record<string, ChannelImpl<unknown>>>(
    chs: TChannels
  ): Promise<SelectResult<TChannels>> | SelectResult<TChannels> {
    let oldestTes = Number.POSITIVE_INFINITY;
    let oldestCh: { key: string; ch: ChannelImpl<unknown> } | null = null;
    let hadChannel = false;

    for (const key in chs) {
      const ch = chs[key];

      if (ch.closed) {
        return { key, value: closed } as SelectResult<TChannels>;
      }

      hadChannel = true;

      const msg = ch[kMessageQueue].peek();

      if (msg && msg.ts < oldestTes) {
        oldestCh = { key, ch };
        oldestTes = msg.ts;
      }
    }

    if (oldestCh) {
      const msg = oldestCh.ch[kMessageQueue].pop()!;

      if (msg.putCb) {
        msg.putCb(true);
      }

      return { key: oldestCh.key, value: msg.msg } as SelectResult<TChannels>;
    }

    if (!hadChannel) {
      throw new TypeError(
        'Calls to select must be objects with string keys mapping to channels, having at least one record'
      );
    }

    // There are no _pending_ messages to immediately resolve the race. Let's register some
    // callbacks.
    return new Promise((resolve) => {
      const disposeFns = [] as Array<() => void>;
      for (const key in chs) {
        const ch = chs[key];
        const cb = (value: unknown) => {
          for (const disposeFn of disposeFns) {
            if (disposeFn !== dispose) {
              disposeFn();
            }
          }

          return resolve({ key, value } as SelectResult<TChannels>);
        };

        const dispose = ch[kReadQueue].push(cb);

        if (!dispose) {
          return resolve(Promise.reject(new ChannelOverflowError()));
        }

        disposeFns.push(dispose);
      }
    });
  }
}

function isPromise<T>(obj: T | Promise<T>): obj is Promise<T> {
  return obj && typeof (obj as any).then === 'function';
}
