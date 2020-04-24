const kItems = Symbol('Queue.items');
const kMaxSize = Symbol('Queue.maxSize');
export class Queue<T> {
  [kItems] = [] as T[];
  [kMaxSize]: number;

  constructor(maxSize = Number.MAX_SAFE_INTEGER) {
    this[kMaxSize] = maxSize;
  }

  get size() {
    return this[kItems].length;
  }

  peek() {
    return this[kItems].length ? this[kItems][this[kItems].length - 1] : undefined;
  }

  pop() {
    return this[kItems].pop();
  }

  push(item: T): false | (() => void) {
    if (this.size >= this[kMaxSize]) {
      return false;
    }

    this[kItems].unshift(item);

    return () => {
      const idx = this[kItems].indexOf(item);

      if (idx >= 0) {
        this[kItems].splice(idx, 1);
      }
    };
  }
}
