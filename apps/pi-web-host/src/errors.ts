export class PiWebHostError extends Error {
  constructor(readonly code: string, readonly unknownOutcome = false) { super(code) }
}
