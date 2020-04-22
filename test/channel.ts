// import { fetch, AbortController, AbortError, AbortSignal } from 'fetch-h2';

import { channel, closed, select } from '../src/channel';

import { expect } from '@hapi/code';
import { script } from '@hapi/lab';

export const lab = script();

const { describe, it } = lab;

describe('Channel', () => {
  describe('[Symbol.asyncIterator]', () => {
    it('will allow asynchronous iteration of a buffered queue', async () => {
      const ch = channel<number>(2);

      expect(await ch.put(1)).to.equal(true);
      expect(await ch.put(2)).to.equal(true);

      setTimeout(() => ch.close());

      let i = 0;

      for await (const value of ch) {
        expect(++i).to.equal(value);
      }

      expect(ch.size).to.equal(0);
      expect(ch.read()).to.equal(undefined);
    });

    it('will allow asynchronous iteration of an unbuffered queue', async () => {
      const ch = channel<number>();

      const put1 = ch.put(1);
      const put2 = ch.put(2);

      setTimeout(() => ch.close());

      let i = 0;

      for await (const value of ch.take()) {
        expect(++i).to.equal(value);
      }

      expect(await put1).to.equal(true);
      expect(await put2).to.equal(true);

      expect(ch.size).to.equal(0);
      expect(ch.read()).to.equal(undefined);
    });
  });

  describe('[Symbol.iterator]', () => {
    it('will allow synchronous iteration of a buffered queue', async () => {
      const ch = channel<number>(2);

      expect(await ch.put(1)).to.equal(true);
      expect(await ch.put(2)).to.equal(true);

      let i = 0;

      for (const value of ch) {
        expect(++i).to.equal(value);
      }

      expect(ch.size).to.equal(0);
      expect(ch.read()).to.equal(undefined);
    });

    it('will allow synchronous iteration of an unbuffered queue', async () => {
      const ch = channel<number>();

      const put1 = ch.put(1);
      const put2 = ch.put(2);

      let i = 0;

      for (const value of ch) {
        expect(++i).to.equal(value);
      }

      expect(await put1).to.equal(true);
      expect(await put2).to.equal(true);

      expect(ch.size).to.equal(0);
      expect(ch.read()).to.equal(undefined);
    });
  });

  describe('#read', () => {
    it('will allow taking synchronously from a buffered queue', async () => {
      const ch = channel(2);

      expect(await ch.put(1)).to.equal(true);
      expect(await ch.put(2)).to.equal(true);

      expect(ch.read()).to.equal(1);
      expect(ch.read()).to.equal(2);
      expect(ch.read()).to.equal(undefined);
    });
  });

  describe('#close', () => {
    it('will close the channel', async () => {
      const ch = channel();

      expect(ch.closed).to.be.false();
      ch.close();
      expect(ch.closed).to.be.true();
    });

    it('will read the closed symbol from closed channels', async () => {
      const ch = channel();

      ch.close();

      expect(await ch.take()).to.equal(closed);
    });

    it('will resolve pending takes with the closed symbol', async () => {
      const ch = channel();
      const takePromises = Promise.all([ch.take(), ch.take()]);

      ch.close();

      expect(await takePromises).to.equal([closed, closed]);
    });

    it('will skip iteration for a closed channel', async () => {
      const ch = channel();

      process.nextTick(() => ch.close());

      let called = 0;
      for await (const _ of ch) {
        called++;
      }

      expect(called).to.equal(0);
    });

    it('will stop iteration when a channel is closed', async () => {
      const ch = channel<number>();
      ch.put(1);
      ch.put(2);

      setTimeout(() => {
        ch.close();
      });

      let called = 0;
      for await (const _ of ch) {
        called++;
      }

      expect(called).to.equal(2);
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

  describe('select', () => {
    it('will resolve on a buffered message', async () => {
      const ch1 = channel<number>();
      const ch2 = channel<string>();

      ch1.put(1);

      const result = await select({
        '1': ch1,
        '2': ch2,
      });

      expect(result).to.equal({ key: '1', value: 1 });
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
