// Converte erros de aplicação e duplicidade PostgreSQL em respostas HTTP.
const { AppError } = require('../errors/AppError');

module.exports = (error, req, res, next) => {
    if (error instanceof AppError) {
        return res.status(error.statusCode).json({ error: error.message });
    }
    if (error.code === '23505') {
        return res.status(409).json({ error: 'e-mail já cadastrado' });
    }
    console.error(error);
    res.status(500).json({ error: 'erro interno' });
};
