export class AppError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "AppError";
  }
}
