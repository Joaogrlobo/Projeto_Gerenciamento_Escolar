// Criação idempotente do administrador inicial.
const bcrypt = require('bcryptjs');
const config = require('../config/env');
const usersRepository = require('../repositories/users.repository');

async function seedAdmin() {
    if (!config.adminEmail || !config.adminPassword) return;
    const passwordHash = await bcrypt.hash(config.adminPassword, 10);
    await usersRepository.createAdminSeed(config.adminEmail.toLowerCase(), passwordHash);
}

module.exports = seedAdmin;
