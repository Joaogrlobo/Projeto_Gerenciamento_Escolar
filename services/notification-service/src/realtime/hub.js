// Mantém as conexões WebSocket autenticadas e entrega avisos conforme o perfil.
const { WebSocketServer, WebSocket } = require('ws');
const jwt = require('jsonwebtoken');

const UNAUTHORIZED = 4401;

function createHub({ jwtSecret, authTimeoutMs = 5000, heartbeatMs = 30000 }) {
    let server = null;
    let heartbeat = null;

    function authenticate(socket, raw) {
        try {
            const { token } = JSON.parse(raw.toString());
            socket.user = jwt.verify(token, jwtSecret);
        } catch {
            socket.close(UNAUTHORIZED, 'não autorizado');
            return;
        }
        clearTimeout(socket.authTimer);
        if (socket.user.exp) {
            socket.expiryTimer = setTimeout(
                () => socket.close(UNAUTHORIZED, 'sessão expirada'),
                socket.user.exp * 1000 - Date.now()
            );
        }
        socket.send(JSON.stringify({ type: 'ready' }));
    }

    function onConnection(socket) {
        socket.isAlive = true;
        socket.authTimer = setTimeout(() => socket.close(UNAUTHORIZED, 'não autorizado'), authTimeoutMs);
        socket.on('pong', () => { socket.isAlive = true; });
        socket.on('message', raw => {
            if (!socket.user) authenticate(socket, raw);
        });
        socket.on('close', () => {
            clearTimeout(socket.authTimer);
            clearTimeout(socket.expiryTimer);
        });
        socket.on('error', () => socket.terminate());
    }

    function attach(httpServer) {
        server = new WebSocketServer({ server: httpServer, path: '/ws/notifications', maxPayload: 4096 });
        server.on('connection', onConnection);
        heartbeat = setInterval(() => {
            for (const socket of server.clients) {
                if (!socket.isAlive) {
                    socket.terminate();
                } else {
                    socket.isAlive = false;
                    socket.ping();
                }
            }
        }, heartbeatMs);
        heartbeat.unref();
    }

    function broadcast({ event_id, type, message, occurred_at, received_at, audience }) {
        if (!server) return;
        const data = JSON.stringify({
            type: 'notification',
            notification: { event_id, type, message, occurred_at, received_at }
        });
        for (const socket of server.clients) {
            if (socket.readyState === WebSocket.OPEN && audience.includes(socket.user?.role)) {
                socket.send(data);
            }
        }
    }

    function close() {
        clearInterval(heartbeat);
        if (!server) return;
        for (const socket of server.clients) socket.terminate();
        server.close();
    }

    return { attach, broadcast, close };
}

module.exports = { createHub };
