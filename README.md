# Channels

An implementation of a closable, tailable `Channel` primitive in idiomatic JavaScript that can be used to decouple producers and consumers in concurrent code.

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

## Concepts

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

A Channel can be closed, signalling that further calls to `put` should be treated as exceptions. When a channel is closed, all outstanding Promises for pending writes will resolve with the value `false`.

> *Note: This means that buffered messages that had been accepted but not consumed will be lost.*

All outstanding, and new iterations consuming the channel will also immediately complete. This also means that iterations racing multiple channels will _also_ immediately stop iteration.

Blocking reads from a channel (such as those waiting for a value to be written to the channel) will resolve to the special `closed` signal.

### Iterable Promises

Blocking reads from `Channel.read` or `select` return objects having a `IterablePromise` type. This object can act both as a `Promise` or as an `AsyncIterable`.

If you are interested in reading a single message from a Channel, you will probably treat these objects as Promises. Note that since a Channel might already be closed, or might become closed after starting to block on an operation, the `Promise` may resolve to a special `closed` signal.

```ts
const message = await channel.take();

if (message === closed) {
  // Handle case where no message was received since the channel is closed
  return;
}

// Handle the message
```

If you are interested in reading a a stream of messages from a Channel, you can leverage the JavaScript `for..await..of` construct:

```ts
for await (const message of channel.take()) {
  // Operate on each message
}
```

## API

### `Channel`

An interface representing a Channel, having the following properties:

- `readonly closed: boolean` a property signalling whether the Channel is closed
- `readonly size: number` a readonly property indicating the total number of pending messages in the channel (buffered or otherwise).
- `close(): void` close the channel.
- `put(msg: unknown): Promise<boolean>` write a message to the channel. The returned Promise will resolve to `true` if the message was consumed (or was buffered). It may resolve to `false` if the channel was closed before the message could be read.

### `channel<T>(bufferSize?: number): Channel<T>`

Create a new Channel that will, optionally, buffer up to `bufferSize` messages. Returns a `Channel` instance.

### `closed: unique symbol`

A `Symbol` to which calls to `Channel.read()` might resolve if the target Channel is closed.

> _**Important**: When using blocking reads, it is important to test resolved values against `closed`._

### `select({ [key: string]: Channel }): IterablePromise<{ key: string, value: unknown }>`

Race multiple channels against each other. This api can be used both as a `Promise` or an `AsyncIterable`. In either case, the resolved value will be an object with the shape `{ key, value }`. The `key` is the key in the object passed to select to identify from which channel the `value` was produced.

### `ChannelClosedError` constructor

The constructor function for the `ChannelClosedError` errors that will be thrown when attempting to write to a closed channel.

## Inspiration

- (@paybase/csp)[https://github.com/paybase/csp] was a major inspiration. I added the ability to close channels and tweaked the approach for `select` to be fully typed.
