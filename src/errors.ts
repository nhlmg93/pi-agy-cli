/**
 * Tagged Effect errors for pi-agy-cli.
 */

import { Data } from "effect";

export class AgyCliUnavailableError extends Data.TaggedError("AgyCliUnavailableError")<{
  readonly binary: string;
  readonly cause?: unknown;
}> {}

export class AgyProcessError extends Data.TaggedError("AgyProcessError")<{
  readonly message: string;
  readonly exitCode?: number | null;
  readonly stderr?: string;
}> {}

export class AgyProtocolError extends Data.TaggedError("AgyProtocolError")<{
  readonly message: string;
  readonly rawLine?: string;
}> {}

export class AgyTimeoutError extends Data.TaggedError("AgyTimeoutError")<{
  readonly timeoutMs: number;
}> {}

export class AgyAbortedError extends Data.TaggedError("AgyAbortedError")<{
  readonly reason: string;
}> {}
