const { randomUUID } = require('node:crypto');

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

module.exports = function requestId(req, res, next) {
    const suppliedId = req.get('X-Request-Id');
    const id = suppliedId && REQUEST_ID_PATTERN.test(suppliedId)
        ? suppliedId
        : randomUUID();

    req.requestId = id;
    res.set('X-Request-Id', id);
    next();
};
