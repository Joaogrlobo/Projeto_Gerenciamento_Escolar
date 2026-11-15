// Converte erros de aplicação e do PostgreSQL em respostas HTTP sem expor detalhes internos.
const { AppError } = require('../errors/AppError');

// Valor com formato inválido (id não numérico, data inválida, texto longo demais).
const INVALID_INPUT_CODES = new Set(['22P02', '22007', '22008', '22001', '22003']);

module.exports = (error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof AppError) {
        return res.status(error.statusCode).json({ error: error.message });
    }
    if (error.type === 'entity.parse.failed') {
        return res.status(400).json({ error: 'JSON inválido' });
    }
    if (error.code === '23505') {
        return res.status(409).json({ error: 'matrícula já cadastrada' });
    }
    if (INVALID_INPUT_CODES.has(error.code)) {
        return res.status(400).json({ error: 'dados inválidos' });
    }
    console.error(error);
    return res.status(500).json({ error: 'erro interno' });
};
