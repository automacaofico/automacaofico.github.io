export class AppError extends Error {
  constructor(message, status = 400, code = 'BAD_REQUEST', details = null) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function publicError(error) {
  if (error instanceof AppError) {
    return { status: error.status, body: { ok: false, error: error.message, code: error.code, details: error.details } };
  }
  console.error('Unhandled worker error', error);
  return { status: 500, body: { ok: false, error: 'Falha interna. A base atual foi preservada.', code: 'INTERNAL_ERROR' } };
}
