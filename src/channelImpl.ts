import { Channel, closed, IterablePromise, IterableValue } from './channel';
import { Queue } from './queue';
import { ChannelClosedError } from './error';

/**
 * @hidden
 */
type ChannelMessage<T> = T extends Channel<infer U> ? U : never;

/**
 * @hidden
 */
type SelectResult<TChannels extends { [key: string]: Channel<any> }> = {
  [TKey in keyof TChannels]: {
    key: TKey;
    value: TakeValue<ChannelMessage<TChannels[TKey]>>;
  };
}[keyof TChannels];

/**
 * @hidden
 */
type SelectIteratorResult<TChannels extends { [key: string]: Channel<any> }> = {
  [TKey in keyof TChannels]: {
    key: TKey;
    value: ChannelMessage<TChannels[TKey]>;
  };
}[keyof TChannels];

/**
 * @hidden
 */
type SelectSyncResult<TChannels extends { [key: string]: Channel<any> }> = {
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
const resolvedFalse = Promise.resolve(false);

export class ChannelImpl<T> implements Channel<T> {
  #bufferSize: number;
  #closed = false;
  readonly #messageQueue = new Queue<{ msg: T; pubCb?: (didPut: boolean) => void }>();
  readonly #takersQueue = new Queue<(msg: TakeValue<T>) => void>();
  readonly #racersQueue = new Queue<(ch: ChannelImpl<T>) => void>();

  constructor(bufferSize = 0) {
    this.#bufferSize = bufferSize;
  }

  get closed() {
    return this.#closed;
  }

  get size() {
    return this.#messageQueue.size;
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

  *[Symbol.iterator]() {
    while (this.size) {
      yield this.read()!;
    }
  }

  close() {
    if (this.#closed) {
      throw new TypeError('Impossible to close a closed channel');
    }

    this.#closed = true;

    while (this.#takersQueue.size) {
      const takerCb = this.#takersQueue.pop()!;

      takerCb(closed);
    }

    while (this.#racersQueue.size) {
      const racerCb = this.#racersQueue.pop()!;

      racerCb(this);
    }
  }

  put(msg: T): Promise<boolean> {
    if (this.#closed) {
      throw new ChannelClosedError();
    }

    // We have a taker waiting, short-circuit
    // the queues
    const taker = this.#takersQueue.pop();
    if (taker) {
      taker(msg);

      return resolvedTrue;
    }

    // This message can be safely buffered and we can immediately ACK it
    if (this.#messageQueue.size < this.#bufferSize) {
      this.#messageQueue.push({ msg });

      return resolvedTrue;
    }

    return new Promise((resolve) => {
      if (!this.#messageQueue.push({ msg, pubCb: resolve })) {
        // The internal message queue is full
        return resolvedFalse;
      }

      const racer = this.#racersQueue.pop();
      if (racer) {
        racer(this);
      }
    });
  }

  read(): T | undefined {
    if (this.#closed) {
      return;
    }

    const pendingMsg = this.#messageQueue.pop();
    if (!pendingMsg) {
      return;
    }

    if (pendingMsg.pubCb) {
      pendingMsg.pubCb(true);
    }

    return pendingMsg.msg;
  }

  take(): IterablePromise<TakeValue<T>, T> {
    const took = this._take();
    const self = this;

    return Object.assign(isPromise(took) ? took : Promise.resolve(took), {
      async *[Symbol.asyncIterator]() {
        const result = isPromise(took) ? await took : took;

        if (result === closed) {
          return;
        }

        yield result;

        while (true) {
          const took = self._take();
          const result = isPromise(took) ? await took : took;

          if (result === closed) {
            return;
          }

          yield result;
        }
      },
    });
  }

  private _race(): Promise<ChannelImpl<T>> | ChannelImpl<T> {
    if (this.size) {
      return this;
    }

    return new Promise<ChannelImpl<T>>((resolve) => {
      this.#racersQueue.push(resolve);
    });
  }

  private _take(): Promise<TakeValue<T>> | TakeValue<T> {
    if (this.#closed) {
      return closed;
    }

    if (this.size) {
      return this.read()!;
    }

    return new Promise((resolve) => {
      this.#takersQueue.push(resolve);
    });
  }

  static select<TChannels extends { [key: string]: Channel<any> }>(
    chs: TChannels
  ): IterablePromise<SelectResult<TChannels>, SelectIteratorResult<TChannels>> {
    const typedChs = (chs as unknown) as { [key: string]: ChannelImpl<any> };
    const selectResult = this._select(typedChs);

    return Object.assign(isPromise(selectResult) ? selectResult : Promise.resolve(selectResult), {
      async *[Symbol.asyncIterator]() {
        const result = isPromise(selectResult) ? await selectResult : selectResult;

        if (result.value === closed) {
          return;
        }

        yield result as SelectIteratorResult<TChannels>;

        while (true) {
          const selectResult = ChannelImpl._select(typedChs);
          const result = isPromise(selectResult) ? await selectResult : selectResult;

          if (result.value === closed) {
            return;
          }

          yield result as SelectIteratorResult<TChannels>;
        }
      },
    });
  }

  public static selectSync<TChannels extends { [key: string]: Channel<any> }>(
    chs: TChannels
  ): IterableValue<SelectSyncResult<TChannels>> {
    const typedChs = (chs as unknown) as { [key: string]: ChannelImpl<any> };
    const selectResult = this._selectSync(typedChs);
    const self = this;

    return Object.assign(selectResult, {
      *[Symbol.iterator]() {
        if (!selectResult) {
          return;
        }

        yield selectResult as SelectSyncResult<TChannels>;

        while (true) {
          const selectResult = self._selectSync(typedChs);

          if (!selectResult) {
            return;
          }

          yield selectResult as SelectSyncResult<TChannels>;
        }
      },
    });
  }

  private static _select<TChannels extends { [key: string]: ChannelImpl<unknown> }>(
    chs: TChannels
  ): Promise<SelectResult<TChannels>> | SelectResult<TChannels> {
    const racers = [] as Array<Promise<[keyof TChannels, TChannels[keyof TChannels]]>>;

    for (const key in chs) {
      const ch = chs[key];
      const raceResult = ch._race();
      let racePromise;

      if (!isPromise(raceResult)) {
        if (ch.#closed) {
          return { key, value: closed } as SelectResult<TChannels>;
        }

        const pending = ch.#messageQueue.pop();

        if (pending) {
          if (pending.pubCb) {
            pending.pubCb(true);
          }

          return { key, value: pending.msg } as SelectResult<TChannels>;
        }

        racePromise = Promise.resolve(raceResult);
      } else {
        racePromise = raceResult;
      }

      racers.push(racePromise.then(() => [key, ch]));
    }

    if (!racers.length) {
      throw new TypeError('At least one channel mapping must be provided to select');
    }

    return Promise.race(racers).then(([key, ch]) => {
      for (const k in chs) {
        const cmp = chs[k];

        if (cmp !== ch) {
          chs[k].#racersQueue.pop();
        }
      }

      if (ch.#closed) {
        return { key, value: closed } as SelectResult<TChannels>;
      }

      const pending = ch.#messageQueue.pop();

      if (!pending) {
        throw new Error('Invariant violation: Channel race settled without any queued messages');
      }

      if (pending.pubCb) {
        pending.pubCb(true);
      }

      return { key, value: pending.msg } as SelectResult<TChannels>;
    });
  }

  private static _selectSync<TChannels extends { [key: string]: ChannelImpl<unknown> }>(
    chs: TChannels
  ): SelectSyncResult<TChannels> | undefined {
    let count = 0;
    for (const key in chs) {
      const ch = chs[key as keyof TChannels];
      const value = ch.read();

      if (value) {
        return { key, value } as any;
      }

      count++;
    }

    if (!count) {
      throw new TypeError('At least one channel mapping must be provided to select');
    }

    return;
  }
}

function isPromise<T>(obj: T | Promise<T>): obj is Promise<T> {
  return obj && typeof (obj as any).then === 'function';
}
