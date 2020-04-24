// import { fetch, AbortController, AbortError, AbortSignal } from 'fetch-h2';

import { channel, closed, select } from '../src/channel';

import { expect } from '@hapi/code';
import { script } from '@hapi/lab';
import { ChannelClosedError } from '../src/error';

export const lab = script();

const { describe, it } = lab;

class Oplog {
  public readonly ops = [] as Array<
    | { type: 'log'; msg: string }
    | { type: 'resolve'; id: string; result: unknown }
    | { type: 'reject'; id: string; err: unknown }
  >;

  log(msg: string) {
    this.ops.push({ type: 'log', msg });
  }

  async run(id: string, op: Promise<unknown>) {
    try {
      const result = await op;

      this.ops.push({ type: 'resolve', id, result });

      return result;
    } catch (err) {
      this.ops.push({ type: 'reject', id, err });

      throw err;
    }
  }
}

describe('Channel', () => {
  describe('.put() / .take()', () => {
    it('will throw when attempting to write to a closed channel', async () => {
      const ch = channel<number>();
      ch.close();

      expect(() => ch.put(1)).to.throw(ChannelClosedError);
    });

    it('will block on an unbuffered channel', async () => {
      const oplog = new Oplog();
      const ch = channel<number>();

      const puts = [
        oplog.run('ch.put(1)', ch.put(1)),
        oplog.run('ch.put(2)', ch.put(2)),
        oplog.run('ch.put(3)', ch.put(3)),
      ];

      const takes = [
        oplog.run('ch.take()', ch.take()),
        oplog.run('ch.take()', ch.take()),
        oplog.run('ch.take()', ch.take()),
      ];

      await Promise.all([...puts, ...takes]);

      ch.close();

      // Here we should see puts and takes interleaved because there is no
      // buffering.
      expect(oplog.ops).to.equal([
        {
          type: 'resolve',
          id: 'ch.put(1)',
          result: true,
        },
        {
          type: 'resolve',
          id: 'ch.take()',
          result: 1,
        },
        {
          type: 'resolve',
          id: 'ch.put(2)',
          result: true,
        },
        {
          type: 'resolve',
          id: 'ch.take()',
          result: 2,
        },
        {
          type: 'resolve',
          id: 'ch.put(3)',
          result: true,
        },
        {
          type: 'resolve',
          id: 'ch.take()',
          result: 3,
        },
      ]);
    });

    it("will block after a buffered channel's buffer is full", async () => {
      const oplog = new Oplog();
      const ch = channel<number>(2);

      const puts = [
        oplog.run('ch.put(1)', ch.put(1)),
        oplog.run('ch.put(2)', ch.put(2)),
        oplog.run('ch.put(3)', ch.put(3)),
      ];

      const takes = [
        oplog.run('ch.take()', ch.take()),
        oplog.run('ch.take()', ch.take()),
        oplog.run('ch.take()', ch.take()),
      ];

      await Promise.all([...puts, ...takes]);

      ch.close();

      // Here we should see the first 2 puts resolve first, followed by the
      // first 2 takes, then the third put and take, respectively. This is because
      // the channel has a 2-item buffer that will be fill up without blocking for
      // a matching take.
      expect(oplog.ops).to.equal([
        {
          type: 'resolve',
          id: 'ch.put(1)',
          result: true,
        },
        {
          type: 'resolve',
          id: 'ch.put(2)',
          result: true,
        },
        {
          type: 'resolve',
          id: 'ch.take()',
          result: 1,
        },
        {
          type: 'resolve',
          id: 'ch.take()',
          result: 2,
        },
        {
          type: 'resolve',
          id: 'ch.put(3)',
          result: true,
        },
        {
          type: 'resolve',
          id: 'ch.take()',
          result: 3,
        },
      ]);
    });

    it('will resolve pending puts with false when an unbuffered channel is closed', async () => {
      const oplog = new Oplog();
      const ch = channel<number>(0);

      const puts = [
        oplog.run('ch.put(1)', ch.put(1)),
        oplog.run('ch.put(2)', ch.put(2)),
        oplog.run('ch.put(3)', ch.put(3)),
      ];

      ch.close();

      const takes = [
        oplog.run('ch.take()', ch.take()),
        oplog.run('ch.take()', ch.take()),
        oplog.run('ch.take()', ch.take()),
      ];

      await Promise.all([...puts, ...takes]);

      // Here we should see the first 2 puts resolve with true since the channel accepted
      // and buffered them. Howevever, since we then close the channel, the third put
      // will resolve with `false` and ALL calls to take should produce the `closed`
      // signal.
      expect(oplog.ops).to.equal([
        {
          type: 'resolve',
          id: 'ch.put(1)',
          result: false,
        },
        {
          type: 'resolve',
          id: 'ch.put(2)',
          result: false,
        },
        {
          type: 'resolve',
          id: 'ch.put(3)',
          result: false,
        },
        {
          type: 'resolve',
          id: 'ch.take()',
          result: closed,
        },
        {
          type: 'resolve',
          id: 'ch.take()',
          result: closed,
        },
        {
          type: 'resolve',
          id: 'ch.take()',
          result: closed,
        },
      ]);
    });

    it('will resolve pending puts with false when a buffered channel is closed', async () => {
      const oplog = new Oplog();
      const ch = channel<number>(2);

      const puts = [
        oplog.run('ch.put(1)', ch.put(1)),
        oplog.run('ch.put(2)', ch.put(2)),
        oplog.run('ch.put(3)', ch.put(3)),
      ];

      ch.close();

      const takes = [
        oplog.run('ch.take()', ch.take()),
        oplog.run('ch.take()', ch.take()),
        oplog.run('ch.take()', ch.take()),
      ];

      await Promise.all([...puts, ...takes]);

      // Here we should see the first 2 puts resolve with true since the channel accepted
      // and buffered them. Howevever, since we then close the channel, the third put
      // will resolve with `false` and ALL calls to take should produce the `closed`
      // signal.
      expect(oplog.ops).to.equal([
        {
          type: 'resolve',
          id: 'ch.put(1)',
          result: true,
        },
        {
          type: 'resolve',
          id: 'ch.put(2)',
          result: true,
        },
        {
          type: 'resolve',
          id: 'ch.put(3)',
          result: false,
        },
        {
          type: 'resolve',
          id: 'ch.take()',
          result: closed,
        },
        {
          type: 'resolve',
          id: 'ch.take()',
          result: closed,
        },
        {
          type: 'resolve',
          id: 'ch.take()',
          result: closed,
        },
      ]);
    });
  });

  describe('[Symbol.asyncIterator]()', () => {
    it('will allow asynchronous iteration of an unbuffered queue', async () => {
      const ch = channel<number>();
      const oplog = new Oplog();

      const puts = [
        oplog.run('ch.put(1)', ch.put(1)),
        oplog.run('ch.put(2)', ch.put(2)),
        oplog.run('ch.put(3)', ch.put(3)),
      ];

      for await (const msg of ch) {
        oplog.log(`got ${msg}`);

        if (!ch.size) {
          ch.close();
        }
      }

      await Promise.all([...puts]);

      expect(oplog.ops).to.equal([
        {
          type: 'resolve',
          id: 'ch.put(1)',
          result: true,
        },
        {
          type: 'log',
          msg: 'got 1',
        },
        {
          type: 'resolve',
          id: 'ch.put(2)',
          result: true,
        },
        {
          type: 'log',
          msg: 'got 2',
        },
        {
          type: 'resolve',
          id: 'ch.put(3)',
          result: true,
        },
        {
          type: 'log',
          msg: 'got 3',
        },
      ]);
    });

    it('will allow asynchronous iteration of a buffered queue', async () => {
      const ch = channel<number>(2);
      const oplog = new Oplog();

      const puts = [
        oplog.run('ch.put(1)', ch.put(1)),
        oplog.run('ch.put(2)', ch.put(2)),
        oplog.run('ch.put(3)', ch.put(3)),
      ];

      for await (const msg of ch) {
        oplog.log(`got ${msg}`);

        if (!ch.size) {
          ch.close();
        }
      }

      await Promise.all([...puts]);

      expect(oplog.ops).to.equal([
        {
          type: 'resolve',
          id: 'ch.put(1)',
          result: true,
        },
        {
          type: 'resolve',
          id: 'ch.put(2)',
          result: true,
        },
        {
          type: 'log',
          msg: 'got 1',
        },
        {
          type: 'log',
          msg: 'got 2',
        },
        {
          type: 'resolve',
          id: 'ch.put(3)',
          result: true,
        },
        {
          type: 'log',
          msg: 'got 3',
        },
      ]);
    });

    it('will interrupt asynchronous iteration of an unbuffered queue when the channel is closed', async () => {
      const ch = channel<number>();
      const oplog = new Oplog();

      const puts = [
        oplog.run('ch.put(1)', ch.put(1)),
        oplog.run('ch.put(2)', ch.put(2)),
        oplog.run('ch.put(3)', ch.put(3)),
      ];

      for await (const msg of ch) {
        oplog.log(`got ${msg}`);

        ch.close();
      }

      await Promise.all([...puts]);

      expect(oplog.ops).to.equal([
        {
          type: 'resolve',
          id: 'ch.put(1)',
          result: true,
        },
        {
          type: 'log',
          msg: 'got 1',
        },
        {
          type: 'resolve',
          id: 'ch.put(2)',
          result: false,
        },
        {
          type: 'resolve',
          id: 'ch.put(3)',
          result: false,
        },
      ]);
    });

    it('will interrupt asynchronous iteration of a buffered queue when the channel is closed', async () => {
      const ch = channel<number>(2);
      const oplog = new Oplog();

      const puts = [
        oplog.run('ch.put(1)', ch.put(1)),
        oplog.run('ch.put(2)', ch.put(2)),
        oplog.run('ch.put(3)', ch.put(3)),
      ];

      for await (const msg of ch) {
        oplog.log(`got ${msg}`);

        ch.close();
      }

      await Promise.all([...puts]);

      expect(oplog.ops).to.equal([
        {
          type: 'resolve',
          id: 'ch.put(1)',
          result: true,
        },
        {
          type: 'resolve',
          id: 'ch.put(2)',
          result: true,
        },
        {
          type: 'log',
          msg: 'got 1',
        },
        {
          type: 'resolve',
          id: 'ch.put(3)',
          result: false,
        },
      ]);
    });
  });

  // describe('[Symbol.iterator]()', () => {
  //   it('will allow synchronous iteration of a buffered queue', async () => {
  //     const ch = channel<number>(2);

  //     expect(await ch.put(1)).to.equal(true);
  //     expect(await ch.put(2)).to.equal(true);

  //     let i = 0;

  //     for (const value of ch) {
  //       expect(++i).to.equal(value);
  //     }

  //     expect(ch.size).to.equal(0);
  //     expect(ch.read()).to.equal(undefined);
  //   });

  //   it('will allow synchronous iteration of an unbuffered queue', async () => {
  //     const ch = channel<number>();

  //     const put1 = ch.put(1);
  //     const put2 = ch.put(2);

  //     let i = 0;

  //     for (const value of ch) {
  //       expect(++i).to.equal(value);
  //     }

  //     expect(await put1).to.equal(true);
  //     expect(await put2).to.equal(true);

  //     expect(ch.size).to.equal(0);
  //     expect(ch.read()).to.equal(undefined);
  //   });
  // });

  // describe('.read()', () => {
  //   it('will allow taking synchronously from a buffered queue', async () => {
  //     const ch = channel(2);

  //     expect(await ch.put(1)).to.equal(true);
  //     expect(await ch.put(2)).to.equal(true);

  //     expect(ch.read()).to.equal(1);
  //     expect(ch.read()).to.equal(2);
  //     expect(ch.read()).to.equal(undefined);
  //   });
  // });

  describe('.close()', () => {
    it('will close the channel', async () => {
      const ch = channel();

      expect(ch.closed).to.be.false();
      ch.close();
      expect(ch.closed).to.be.true();
    });

    it('will throw when attempting to close a closed channel', () => {
      const ch = channel();

      ch.close();
      expect(() => ch.close()).to.throw(ChannelClosedError);
    });
  });

  describe('#put', () => {
    it('will resolve when the message is consumed', async () => {
      const ch = channel<number>(1);

      const put1 = ch.put(1);

      expect(ch.size).to.equal(1);

      const res1 = await ch.take();
      expect(res1).to.equal(1);
      expect(await put1).to.equal(true);
    });

    it('will buffer messages', async () => {
      const ch = channel<string>();

      const put1 = ch.put('1');
      expect(ch.size).to.equal(1);

      const put2 = ch.put('2');
      expect(ch.size).to.equal(2);

      const res1 = await ch.take();
      expect(ch.size).to.equal(1);
      expect(res1).to.equal('1');
      expect(await put1).to.equal(true);

      const res2 = await ch.take();
      expect(ch.size).to.equal(0);
      expect(res2).to.equal('2');
      expect(await put2).to.equal(true);
    });

    it('will buffer a limited number of messages', async () => {
      const ch = channel<string>(1);
      const results = {
        put1: undefined as undefined | boolean,
        put2: undefined as undefined | boolean,
      };

      const put1 = ch.put('1').then((result) => (results.put1 = result));
      expect(await put1).to.equal(true);
      expect(results.put1).to.equal(true);
      expect(ch.size).to.equal(1);

      const put2 = ch.put('2').then((result) => (results.put2 = result));
      expect(ch.size).to.equal(2);

      const res1 = await ch.take();
      expect(results.put2).to.be.undefined();
      expect(ch.size).to.equal(1);
      expect(res1).to.equal('1');

      expect(await ch.take()).to.equal('2');
      expect(await put2).to.equal(true);
      expect(ch.size).to.equal(0);
      expect(results.put2).to.equal(true);
    });
  });

  describe('select()', () => {
    it('will deliver messages predictably among consumers via individual calls to select', async () => {
      const ch1 = channel<number>();
      const ch2 = channel<number>();
      const oplog = new Oplog();

      const puts = [
        oplog.run('ch1.put(1)', ch1.put(1)),
        oplog.run('ch2.put(2)', ch2.put(2)),
        oplog.run('ch1.put(3)', ch1.put(3)),
      ];

      const selects = [
        oplog.run('select', select({ ch1, ch2 })),
        oplog.run('select', select({ ch1, ch2 })),
        oplog.run('select', select({ ch1, ch2 })),
      ];

      await Promise.all([...puts, ...selects]);

      ch1.close();
      ch2.close();

      expect(oplog.ops).to.equal([
        {
          type: 'resolve',
          id: 'ch1.put(1)',
          result: true,
        },
        {
          type: 'resolve',
          id: 'select',
          result: { key: 'ch1', value: 1 },
        },
        {
          type: 'resolve',
          id: 'ch2.put(2)',
          result: true,
        },
        {
          type: 'resolve',
          id: 'select',
          result: { key: 'ch2', value: 2 },
        },
        {
          type: 'resolve',
          id: 'ch1.put(3)',
          result: true,
        },
        {
          type: 'resolve',
          id: 'select',
          result: { key: 'ch1', value: 3 },
        },
      ]);
    });

    it('will deliver messages predictably among consumers via select iteration', async () => {
      const ch1 = channel<number>();
      const ch2 = channel<number>();
      const oplog = new Oplog();

      const puts = [
        oplog.run('ch1.put(1)', ch1.put(1)),
        oplog.run('ch2.put(2)', ch2.put(2)),
        oplog.run('ch1.put(3)', ch1.put(3)),
      ];

      setTimeout(() => {
        ch1.close();
        ch2.close();
      });

      for await (const { key, value: msg } of select({ ch1, ch2 })) {
        oplog.log(`${key}: ${msg}`);
      }

      await Promise.all([...puts]);

      expect(oplog.ops).to.equal([
        {
          type: 'resolve',
          id: 'ch1.put(1)',
          result: true,
        },
        {
          type: 'log',
          msg: 'ch1: 1',
        },
        {
          type: 'resolve',
          id: 'ch2.put(2)',
          result: true,
        },
        {
          type: 'log',
          msg: 'ch2: 2',
        },
        {
          type: 'resolve',
          id: 'ch1.put(3)',
          result: true,
        },
        {
          type: 'log',
          msg: 'ch1: 3',
        },
      ]);
    });

    it('will resolve on a later message', async () => {
      const ch1 = channel<number>();
      const ch2 = channel<string>();

      const resultPromise = select({
        '1': ch1,
        '2': ch2,
      });

      ch1.put(1);

      const result = await resultPromise;

      expect(result).to.equal({ key: '1', value: 1 });
    });

    it('will settle when a raced channel is closed', async () => {
      const ch1 = channel<number>();
      const ch2 = channel<string>();

      const racePromise = select({
        '1': ch1,
        '2': ch2,
      });

      ch1.close();

      expect(await racePromise).to.equal({ key: '1', value: closed });
    });

    it('will allow iterating races', async () => {
      const ch1 = channel<number>();
      const ch2 = channel<string>();

      const race = select({
        '1': ch1,
        '2': ch2,
      });

      setTimeout(() => ch1.close());

      ch1.put(1);
      ch2.put('2');

      const results = [];
      for await (const result of race) {
        results.push(result);
      }

      expect(results).to.equal([
        { key: '1' as const, value: 1 },
        { key: '2' as const, value: '2' },
      ]);
    });
  });
});
