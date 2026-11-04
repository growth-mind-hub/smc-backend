export function sendError(req, res, status, code, message, details) {
  return res.status(status).json({
    error: { code, message, ...(details ? { details } : {}) },
    requestId: req.requestId,
  });
}

export function errorHandler(logger) {
  return (err, req, res, next) => {
    if (res.headersSent) {return next(err);}
    if (err.type === 'entity.too.large') {return sendError(req, res, 413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds the endpoint size limit.');}
    if (err.type === 'entity.parse.failed') {return sendError(req, res, 400, 'INVALID_JSON', 'Malformed JSON body.');}
    if (err.status === 415) {return sendError(req, res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Unsupported JSON encoding or charset.');}
    // Avoid logging database errors that may include submitted values or credentials.
    logger.error(JSON.stringify({ requestId: req.requestId, event: 'request_error', code: err.code ?? 'UNKNOWN' }));
    return sendError(req, res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  };
}
