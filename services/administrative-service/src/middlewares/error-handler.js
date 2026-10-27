const { AppError } = require('../errors/AppError');

module.exports = (error, req, res, next) => {
    if (error instanceof AppError) {
        return res.status(error.statusCode).json({ error: error.message });
    }
    if (error.code === '23505') {
        return res.status(409).json({ error: 'já existe um registro com esses dados exclusivos' });
    }
    if (error.code === '23503') {
        return res.status(404).json({ error: 'turma ou disciplina não encontrada' });
    }
    if (error.code === '23514') {
        return res.status(400).json({ error: 'dados inválidos para o recurso' });
    }
    if (error.code === '23502') {
        return res.status(400).json({ error: 'campo obrigatório ausente' });
    }
    if (error.type === 'entity.parse.failed') {
        return res.status(400).json({ error: 'corpo JSON inválido' });
    }
    console.error(error);
    res.status(500).json({ error: 'erro interno' });
};
