// Converte erros da aplicação para respostas HTTP seguras.
const { AppError } = require('../errors/AppError');

module.exports = (error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof AppError) {
        return res.status(error.statusCode).json({ error: error.message });
    }
    res.status(500).json({ error: 'erro interno' });
};
