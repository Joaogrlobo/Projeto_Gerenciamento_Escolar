// Envia ao RabbitMQ os eventos pendentes da outbox, removendo-os só após a confirmação.
function withTimeout(promise, timeoutMs) {
    let timer;
    const timeout = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('timeout publicando evento')), timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function createRelay({ pool, publish, batchSize = 50, intervalMs = 1000, publishTimeoutMs = 2000 }) {
    let timer = null;
    let failing = false;

    async function tick() {
        let client;
        try {
            client = await pool.connect();
            await client.query('BEGIN');
            const { rows } = await client.query(
                'SELECT id, type, envelope FROM outbox_events ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED',
                [batchSize]
            );
            for (const row of rows) {
                await withTimeout(publish(row.type, row.envelope), publishTimeoutMs);
            }
            if (rows.length) {
                await client.query('DELETE FROM outbox_events WHERE id = ANY($1)', [rows.map(row => row.id)]);
            }
            await client.query('COMMIT');
            failing = false;
            return rows.length;
        } catch (error) {
            if (!failing) console.error('Outbox aguardando para reenviar eventos:', error.message);
            failing = true;
            try {
                await client?.query('ROLLBACK');
            } catch {
                // Uma conexão perdida já descarta a transação.
            }
            return 0;
        } finally {
            client?.release();
        }
    }

    function schedule(delay) {
        timer = setTimeout(async () => {
            const sent = await tick();
            if (timer) schedule(sent === batchSize ? 0 : intervalMs);
        }, delay);
        timer.unref();
    }

    return {
        tick,
        start() { if (!timer) schedule(intervalMs); },
        stop() { clearTimeout(timer); timer = null; }
    };
}

module.exports = { createRelay };
