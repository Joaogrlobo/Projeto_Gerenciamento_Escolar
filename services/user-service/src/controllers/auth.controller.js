// Adaptador HTTP dos endpoints de autenticação.
const usersService = require('../services/users.service');

async function register(req, res) {
    const user = await usersService.registerUser(req.body);
    res.status(201).json(user);
}

async function login(req, res) {
    res.json(await usersService.login(req.body));
}

function me(req, res) {
    res.json(req.user);
}

module.exports = { register, login, me };
