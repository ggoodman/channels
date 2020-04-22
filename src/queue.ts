export class Queue<T> {
  #items = [] as T[];
  #maxSize: number;

  constructor(maxSize = Number.MAX_SAFE_INTEGER) {
    this.#maxSize = maxSize;
  }

  get size() {
    return this.#items.length;
  }

  pop() {
    return this.#items.pop();
  }

  push(item: T) {
    if (this.size >= this.#maxSize) {
      return false;
    }

    this.#items.unshift(item);

    return true;
  }
}
