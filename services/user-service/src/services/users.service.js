// Regras de cadastro, autenticação e emissão de token de usuários.
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config/env');
const usersRepository = require('../repositories/users.repository');
const { BadRequestError, UnauthorizedError } = require('../errors/AppError');
const { publishEvent } = require('../messaging/publisher');
const { withTransaction } = require('../config/db');

const ROLES = ['admin', 'teacher', 'student', 'parent', 'staff'];
const PUBLIC_ROLES = ['student', 'parent'];

function isFilledString(value) {
    return typeof value === 'string' && value.trim() !== '';
}

async function createUser({ name, email, password, role }) {
    if (!isFilledString(name) || !isFilledString(email) || !isFilledString(password)) {
        throw new BadRequestError('name, email e password são obrigatórios');
    }
    if (password.length < 6) {
        throw new BadRequestError('senha deve ter ao menos 6 caracteres');
    }
    const passwordHash = await bcrypt.hash(password, 10);
    return withTransaction(async client => {
        const user = await usersRepository.create({ name, email: email.toLowerCase(), passwordHash, role }, client);
        await publishEvent('user.registered', { userId: user.id, role: user.role }, client);
        return user;
    });
}

async function registerUser(user) {
    const role = PUBLIC_ROLES.includes(user.role) ? user.role : 'student';
    return createUser({ ...user, role });
}

async function createAdminUser(user) {
    if (!ROLES.includes(user.role)) {
        throw new BadRequestError('role inválida');
    }
    return createUser(user);
}

async function login({ email, password }) {
    if (!isFilledString(email) || !isFilledString(password)) {
        throw new BadRequestError('email e password são obrigatórios');
    }
    const user = await usersRepository.findByEmail(email.toLowerCase());
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        throw new UnauthorizedError('credenciais inválidas');
    }
    const token = jwt.sign(
        { sub: user.id, name: user.name, role: user.role },
        config.jwtSecret,
        { expiresIn: '2h' }
    );
    await publishEvent('user.logged', { userId: user.id, role: user.role });
    return {
        token,
        user: { id: user.id, name: user.name, email: user.email, role: user.role }
    };
}

function listUsers() {
    return usersRepository.list();
}

module.exports = { registerUser, createAdminUser, login, listUsers };
