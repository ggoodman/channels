import { TakeValue, ChannelImpl } from './channelImpl';

/**
 * A `Promise` that is also an `AsyncIterable`.
 *
 * This is a utility type to represent objects that can be used both as a `Promise`
 * or as an `AsyncIterable`.
 *
 * Example:
 *
 * ```ts
 * import { channel, closed } from '@ggoodman/channels';
 *
 * const ch = channel();
 *
 * const msg = await ch.take(); // Use the value as a promise
 *
 * if (msg === closed) {
 *   // Ignore this?
 * }
 *
 * // Do something with msg
 * ```
 *
 * ```ts
 * import { channel } from '@ggoodman/channels';
 *
 * const ch = channel();
 *
 * for await (const msg of ch.take()) {
 *   // Do something with msg
 * }
 * ```
 *
 * @template T The message type that will resolve when used as a `Promise`.
 * @template U The message type that will be produced when used as an `AsyncIterable`.
 */
export type IterablePromise<T, U = T> = Promise<T> & AsyncIterable<U>;

export type IterableValue<T, U = T> = T & Iterable<U>;

export const closed = Symbol('channel.closed');
export type closed = typeof closed;

/**
 * A CSP-style channel.
 *
 * Represents an optionally-buffered unidirectional channel for typed messages. Typically
 * different logical bits of code are responsible for reading from ({@link Channel.take | take})
 * and writing to({@link Channel.put | put}) a {@link Channel}. This two bits of code do not need
 * to be concerned about the timing of the reads and writes; the {@link Channel} should coordinate
 * that.
 *
 * **Buffered vs unbuffered**:
 *
 * A {@link Channel} can be _buffered_ or _unbuffered_. When a {@link Channel} is buffered, that
 * means any messages that a producer attempts to {@link Channel.put | put} will be dropped if the
 * {@link Channel}'s buffer is full. When that happens, {@link Channel.put} will return `false`.
 *
 * **Closing channels**:
 *
 * A {@link Channel} can be _closed_, using the {@link Channel.close | close} method. At any time,
 * code may determine if the channel is closed by reading the {@link Channel.closed | closed}
 * property.
 *
 * Attempting to close a channel more than once will throw a {@link ChannelClosedError} exception.
 *
 * When a {@link Channel} is closed, all open `Iterable`s will immediately return, breaking out of
 * their loops. Any pending `Promise`s, such as those returned by {@link Channel.take} or
 * {@link select}, will immediately resolve with the {@link closed} symbol.
 *
 * Code waiting on `Promise`s from {@link Channel.take} or {@link select} must test against this
 * value:
 *
 * ```ts
 * import { channel, closed } from '@ggoodman/channels';
 *
 * const ch = channel();
 * const msg = await ch.take();
 *
 * if (msg === closed) {
 *  // Handle channel being closed before producing an actual message
 * }
 * ```
 *
 * **Using as an `AsyncIterable`**:
 *
 * A {@link Channel} actually implements the
 * [Async iteration protocol](https://2ality.com/2016/10/asynchronous-iteration.html), so a
 * {@link Channel} can be iterated directly using a `for await...of` loop:
 *
 * ```ts
 * import { channel } from '@ggoodman/channels';
 *
 * const ch = channel();
 *
 * for await (const msg of ch) {
 *   // Do something with msg
 * }
 * ```
 *
 * @typeParam T The type of values that will be produced by the channel
 */
export interface Channel<T> extends Iterable<T> {
  /**
   * Indication of whether this channel is closed.
   */
  readonly closed: boolean;

  /**
   * The number of queued messages in the channel.
   */
  readonly size: number;

  /**
   * Closes the channel.
   *
   * This immediately causes all pending `Promise`s to resolve
   * with the `closed` symbol. It will immediately cause all `AsyncIterator`s to
   * return, skipping further iteration.
   *
   * Attempting to call `put` on a closed channel will throw a {@link ChannelClosedError}.
   * Subsequent calls to {@link Channel.take | take} or {@link select} that include this channel will
   * immediately resolve / complete iteration.
   */
  close(): void;

  /**
   * Write a message to the channel.
   *
   * If the channel is closed, a {@link ChannelClosedError} exception will be thrown. If
   * the channel has a fixed buffer size and this message would cause that buffer to
   * be exceeded, the message will be discarded and this function will return `false`.
   *
   * @param msg The message to write to the channel
   * @returns A promise for whether the message was accepted or not. This will always be true for
   * unbuffered channels.
   */
  put(msg: T): Promise<boolean>;

  read(): T | undefined;

  /**
   * Waits for a message (or `AsyncIterable` therefor).
   *
   * This is the method that a consumer will be calling to obtain a value (or stream
   * thereof) from the {@link Channel}.
   *
   * When the channel is _closed_ and this method's return value is used as a `Promise`,
   * the returned promise will resolve to the {@link closed} symbol. When the channel
   * is _closed_ and this method's return value is used as an `AsyncIterable`, the
   * iterable will not produce any values and will immediately 'return'.
   *
   * @returns An {@link IterablePromise}, so the return value can either be used as a
   * `Promise` or as an `AsyncIterable`.
   */
  take(): IterablePromise<TakeValue<T>, T>;

  /**
   * @ignore
   */
  [Symbol.asyncIterator](): AsyncIterator<T>;

  /**
   * @ignore
   */
  [Symbol.iterator](): Iterator<T>;
}

export function channel<T>(size?: number): Channel<T> {
  if (size) {
    if ((size | 0) !== size) throw new TypeError('Channel size must be an integer value');
    if (size < 1)
      throw new TypeError('Channel size must be greater than or equal to 1, when specified');
  }

  return new ChannelImpl(size);
}

export function select<TChannels extends { [key: string]: Channel<any> }>(chs: TChannels) {
  return ChannelImpl.select(chs);
}

export function selectSync<TChannels extends { [key: string]: Channel<any> }>(chs: TChannels) {
  return ChannelImpl.selectSync(chs);
}
