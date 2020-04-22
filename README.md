# Channels

An implementation of a `Channel` primitive that can be used to decouple producers and consumers in concurrent code.

[![npm version](https://badge.fury.io/js/%40ggoodman%2Fchannels.svg)](https://npm.im/%40ggoodman%2Fchannels)

Features:

- Designed for JavaScript and its 'concurrency' model.
- Uses modern JavaScript features like synchronous and asynchronous iterators.
- Supports closing channels and racing between channels.

## Installation

```bash
npm install --save @ggoodman/channels
```

or

```bash
yarn add @ggoodman/channels
```

## Example

```ts
import { channel, Channel } from './';

const timeout = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const createBall = () => ({ hits: 0, status: '' });
type Ball = ReturnType<typeof createBall>;

const wiff = channel<Ball>();
const waff = channel<Ball>();

const createBat = async (inbound: Channel<Ball>, outbound: Channel<Ball>) => {
  for await (const ball of inbound) {
    ball.hits++;
    ball.status = ball.status === 'wiff!' ? 'waff!' : 'wiff!';
    console.log(`🎾 Ball hit ${ball.hits} time(s), ${ball.status}`);
    await outbound.put(ball); // smash the ball back
    await timeout(500); // assume it's going to take a bit to hit the ball
  }
  console.log(`🛑 OK, fun's over`);
};

process.on('SIGINT', () => {
  // Important to close BOTH sides because if the timing is unlucky, you read from
  // the open side and attempt to write to the closed side.
  wiff.close();
  waff.close();
});

createBat(waff, wiff); // create a bat that will wiff waffs
createBat(wiff, waff); // create a bat that will waff wiffs

waff.put(createBall());
```

## Channel design

### Writing

Writing to a channel is a blocking operation. That is, it returns a `Promise<boolean>`. Code that is writing to a channel should typically block on the write using something like:

```ts
await channel.put(message);
```

The returned Promise will only resolve at the earlier of:

1. The target Channel is closed. In that case, the returned Promise will resolve to `false`.
2. A message is consumed from the target channel. In that case the Promise will resolve to `true`.
3. The target Channel is _buffered_ and its buffer is not yet full.

#### Buffered vs unbuffered

However, sometimes you may want to be able to write a certain number of messages to a Channel before any readers start consuming messages. In a single-threaded environment, like JavaScript, this could easily lead to a deadlocked program; execution will never proceed to the logic consuming from the channel since it is blocked on writing to it.

To get around this, a Channel may be created with a buffer size. As many messages as the buffer size can be written to the Channel before calls to `put` will block on a read.

### Closing channels

A Channel can be closed, signalling that further calls to `put` should be treaded as exceptions. When a channel is closed, all outstanding Promises for pending writes will resolve with the value `false`.

> *Note: This means that buffered messages that had been accepted but not consumed will be lost.*

All outstanding, and new iterations consuming the channel will also immediately complete. This also means that iterations racing multiple channels will _also_ immediately stop iteration.

Blocking reads from a channel (such as those waiting for a value to be written to the channel) will resolve to the special `closed` signal.

### `Channel` interface

```ts
/**
 * A CSP-style channel.
 *
 * Represents an optionally-buffered unidirectional channel for typed messages.
 */
export interface Channel<T> {
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
}
```

### `IterablePromise` type

```ts
/**
 * A `Promise` that is also an `AsyncIterable`.
 *
 * This is a utility type to represent objects that can be used both as a `Promise`
 * or as an `AsyncIterable`.
 *
 * @template T The message type that will resolve when used as a `Promise`.
 * @template U The message type that will be produced when used as an `AsyncIterable`.
 */
export type IterablePromise<T, U = T> = Promise<T> & AsyncIterable<U>;
```

#### Used for blocking reads

```ts
import { channel, closed } from '@ggoodman/channels';

const ch = channel();

const msg = await ch.take(); // Use the value as a promise

if (msg === closed) {
  // Ignore this?
}

// Do something with msg
```

#### Used for asynchronous iteration
```ts
import { channel } from '@ggoodman/channels';

const ch = channel();

for await (const msg of ch.take()) {
  // Do something with msg
}
```

### `channel(bufferSize?: number): Channel`

Create a new Channel with an optional buffer size.

### `closed: unique symbol`

A `Symbol` to which calls to `Channel.read()` might resolve if the target Channel is closed.

> _**Important**: When using blocking reads, it is important to test resolved values against `closed`._

### `select({ [key: string]: Channel }): IterablePromise<{ key: string, value: unknown }>`

Race multiple channels against each other. This api can be used both as a `Promise` or an `AsyncIterable`. In either case, the resolved value will be an object with the shape `{ key, value }`. The `key` is the key in the object passed to select to identify from which channel the `value` was produced.

### `ChannelClosedError` constructor

The constructor function for the `ChannelClosedError` errors that will be thrown when attempting to write to a closed channel.

## Inspiration

- (@paybase/csp)[https://github.com/paybase/csp] was a major inspiration. I added the ability to close channels and tweaked the approach for `select` to be fully typed.
