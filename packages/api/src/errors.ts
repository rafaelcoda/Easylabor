export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;
  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (what = 'Recurso') => new ApiError(404, 'not_found', `${what} não encontrado`);
export const forbidden = (message = 'Você não tem permissão para esta ação') => new ApiError(403, 'forbidden', message);
export const conflict = (code: string, message: string, details?: Record<string, unknown>) => new ApiError(409, code, message, details);
export const unprocessable = (code: string, message: string, details?: Record<string, unknown>) => new ApiError(422, code, message, details);
