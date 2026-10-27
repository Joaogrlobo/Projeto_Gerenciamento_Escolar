// Converte erros conhecidos e falhas inesperadas para respostas JSON.
const { AppError } = require('../errors/AppError');

module.exports = (error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof AppError) {
        return res.status(error.statusCode).json({ error: error.message });
    }
    if (error.code === '23505') {
        return res.status(409).json({ error: 'inscrição já cadastrada' });
    }
    if (error.code === '23503') {
        return res.status(404).json({ error: 'inscrição não encontrada' });
    }
    if (error.type === 'entity.parse.failed') {
        return res.status(400).json({ error: 'JSON inválido' });
    }
    console.error(error);
    return res.status(500).json({ error: 'erro interno' });
};
