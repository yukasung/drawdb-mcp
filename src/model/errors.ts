/**
 * An error whose message is meant to be read by the model calling the tool, so
 * it can correct itself without a round trip to the user. Always name what was
 * asked for and what was available.
 */
export class DrawdbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DrawdbError";
  }
}

export function notFound(kind: string, ref: string, available: string[]): DrawdbError {
  const list = available.length ? available.join(", ") : "(none)";
  return new DrawdbError(`${kind} "${ref}" not found. Available ${kind}s: ${list}`);
}
