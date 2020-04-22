export class ChannelClosedError extends Error {
  constructor() {
    super('Channel closed');
    this.name = this.constructor.name;
  }
}
