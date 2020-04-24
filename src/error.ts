export class ChannelClosedError extends Error {
  constructor() {
    super('Channel closed');
    this.name = this.constructor.name;
  }
}

export class ChannelOverflowError extends RangeError {
  constructor() {
    super('Channel overflowed');
    this.name = this.constructor.name;
  }
}
