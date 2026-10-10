// How a stage says it can't go on. Anything else it throws is retried with
// a growing pause, a few times, before the item fails.

/** Stops the item (until someone retries it): trying again wouldn't change anything. */
export class Fatal extends Error {}

/** Not a failure: the item waits `wait` ms (for quota, a setting, Gelato) and tries again. */
export class Parked extends Error {
  constructor(
    readonly wait: number,
    message: string
  ) {
    super(message)
  }
}

/** A plan or request that can't be done as asked: answered with 400. */
export class PlanError extends Error {}
