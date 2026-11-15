// Adaptador HTTP dos endpoints administrativos de usuários.
const usersService = require('../services/users.service');

async function create(req, res) {
    const user = await usersService.createAdminUser(req.body ?? {});
    res.status(201).json(user);
}

async function list(req, res) {
    res.json(await usersService.listUsers());
}

module.exports = { create, list };
