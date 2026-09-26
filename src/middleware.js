/**
 * Lua Obf — Middleware.
 * Request logging and error handling.
 */

export function requestLogger(req, res, next) {
  const start = Date.now();
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';

  res.on('finish', () => {
    const elapsed = Date.now() - start;
    const size = res.get('Content-Length') || '?';
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ` +
      `${res.statusCode} ${elapsed}ms ${size}b ${ip}`
    );
  });

  next();
}

export function errorHandler(err, req, res, next) {
  // Log full error server-side
  console.error('[lua-obf] error:', err && err.stack ? err.stack : err);

  // Do not leak internals to client
  const status = err && err.statusCode ? err.statusCode : 500;
  const message = process.env.NODE_ENV === 'production'
    ? 'Internal server error'
    : (err && err.message ? err.message : 'Unknown error');

  if (res.headersSent) {
    return next(err);
  }

  res.status(status).json({
    ok: false,
    error: message,
  });
}

export function asyncHandler(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}