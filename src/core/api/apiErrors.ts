/**
 * API Error Handling
 * Centralized error types and handling for the Forge API.
 * Mirrors iOS ForgeAPIError pattern.
 */

// MARK: - Error Codes

export enum ForgeAPIErrorCode {
  InvalidURL = 'INVALID_URL',
  NoData = 'NO_DATA',
  DecodingError = 'DECODING_ERROR',
  ServerError = 'SERVER_ERROR',
  NetworkError = 'NETWORK_ERROR',
  Unauthorized = 'UNAUTHORIZED',
  NoAuthToken = 'NO_AUTH_TOKEN',
  NotFound = 'NOT_FOUND',
  Forbidden = 'FORBIDDEN',
  ValidationError = 'VALIDATION_ERROR',
  RateLimited = 'RATE_LIMITED',
  Unknown = 'UNKNOWN',
}

// MARK: - Error Class

export class ForgeAPIError extends Error {
  public readonly code: ForgeAPIErrorCode;
  public readonly statusCode?: number;
  public readonly details?: unknown;
  public readonly originalError?: Error;

  constructor(
    code: ForgeAPIErrorCode,
    message: string,
    statusCode?: number,
    details?: unknown,
    originalError?: Error
  ) {
    super(message);
    this.name = 'ForgeAPIError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.originalError = originalError;

    // Maintain proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ForgeAPIError);
    }
  }

  /**
   * Create an error from a fetch Response
   */
  static async fromResponse(response: Response): Promise<ForgeAPIError> {
    let body: unknown;
    let message = '';

    try {
      body = await response.json();
      if (typeof body === 'object' && body !== null && 'message' in body) {
        message = (body as { message: string }).message;
      } else if (typeof body === 'object' && body !== null && 'error' in body) {
        message = (body as { error: string }).error;
      }
    } catch {
      // Response body is not JSON
    }

    switch (response.status) {
      case 400:
        return new ForgeAPIError(
          ForgeAPIErrorCode.ValidationError,
          message || 'Invalid request data',
          400,
          body
        );
      case 401:
        return new ForgeAPIError(
          ForgeAPIErrorCode.Unauthorized,
          message || 'Unauthorized access',
          401,
          body
        );
      case 403:
        return new ForgeAPIError(
          ForgeAPIErrorCode.Forbidden,
          message || 'Access forbidden',
          403,
          body
        );
      case 404:
        return new ForgeAPIError(
          ForgeAPIErrorCode.NotFound,
          message || 'Resource not found',
          404,
          body
        );
      case 429:
        return new ForgeAPIError(
          ForgeAPIErrorCode.RateLimited,
          message || 'Too many requests',
          429,
          body
        );
      default:
        return new ForgeAPIError(
          ForgeAPIErrorCode.ServerError,
          message || `Server error: ${response.status}`,
          response.status,
          body
        );
    }
  }

  /**
   * Create an error from a network/fetch error
   */
  static fromNetworkError(error: Error): ForgeAPIError {
    return new ForgeAPIError(
      ForgeAPIErrorCode.NetworkError,
      error.message || 'Network request failed',
      undefined,
      undefined,
      error
    );
  }

  /**
   * Create an error for decoding failures
   */
  static decodingError(error?: Error): ForgeAPIError {
    return new ForgeAPIError(
      ForgeAPIErrorCode.DecodingError,
      'Failed to decode response',
      undefined,
      undefined,
      error
    );
  }

  /**
   * Create an error for missing auth token
   */
  static noAuthToken(): ForgeAPIError {
    return new ForgeAPIError(
      ForgeAPIErrorCode.NoAuthToken,
      'No authentication token available'
    );
  }

  /**
   * Get user-friendly error message
   */
  get userMessage(): string {
    switch (this.code) {
      case ForgeAPIErrorCode.InvalidURL:
        return 'Invalid request URL';
      case ForgeAPIErrorCode.NoData:
        return 'No data received from server';
      case ForgeAPIErrorCode.DecodingError:
        return 'Unable to process server response';
      case ForgeAPIErrorCode.ServerError:
        return 'Server is experiencing issues. Please try again later.';
      case ForgeAPIErrorCode.NetworkError:
        return 'Unable to connect. Please check your internet connection.';
      case ForgeAPIErrorCode.Unauthorized:
        return 'Please sign in to continue';
      case ForgeAPIErrorCode.NoAuthToken:
        return 'Please sign in to continue';
      case ForgeAPIErrorCode.NotFound:
        return 'The requested content was not found';
      case ForgeAPIErrorCode.Forbidden:
        return "You don't have permission to access this content";
      case ForgeAPIErrorCode.ValidationError:
        return this.message || 'Invalid input data';
      case ForgeAPIErrorCode.RateLimited:
        return 'Too many requests. Please wait a moment and try again.';
      default:
        return 'Something went wrong. Please try again.';
    }
  }

  /**
   * Check if the error is due to authentication issues
   */
  get isAuthError(): boolean {
    return (
      this.code === ForgeAPIErrorCode.Unauthorized ||
      this.code === ForgeAPIErrorCode.NoAuthToken
    );
  }

  /**
   * Check if the error is retryable
   */
  get isRetryable(): boolean {
    return (
      this.code === ForgeAPIErrorCode.NetworkError ||
      this.code === ForgeAPIErrorCode.ServerError ||
      this.code === ForgeAPIErrorCode.RateLimited
    );
  }
}

// MARK: - Type Guard

export function isForgeAPIError(error: unknown): error is ForgeAPIError {
  return error instanceof ForgeAPIError;
}

// MARK: - Helper Functions

/**
 * Extract a user-friendly error message from any error
 */
export function getErrorMessage(error: unknown): string {
  if (isForgeAPIError(error)) {
    return error.userMessage;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'An unexpected error occurred';
}
