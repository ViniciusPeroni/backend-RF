'use strict';

const { EventEmitter } = require('events');

// Cliente mínimo de teste: Engine.IO v4 sobre WebSocket + namespace padrão
// Socket.IO. Não é um cliente de aplicação: não implementa polling nem retry.
function connectNotificationSocket(baseUrl, auth = {}) {
    if (typeof WebSocket !== 'function') {
        throw new Error('Os testes de transporte real exigem Node.js 22+ (WebSocket nativo).');
    }

    const url = new URL('/socket.io/?EIO=4&transport=websocket', baseUrl);
    url.protocol = 'ws:';
    const socket = new WebSocket(url);
    const received = new EventEmitter();
    const events = [];
    let connected = false;

    const ready = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            socket.close();
            reject(new Error('Timeout na conexão Socket.IO de teste.'));
        }, 5000);

        socket.addEventListener('message', ({ data }) => {
            const packet = String(data);
            if (packet.startsWith('0')) {
                socket.send(`40${JSON.stringify(auth)}`);
            } else if (packet === '2') {
                socket.send('3');
            } else if (packet.startsWith('40')) {
                connected = true;
                clearTimeout(timeout);
                resolve();
            } else if (packet.startsWith('42')) {
                const [event, payload] = JSON.parse(packet.slice(2));
                events.push({ event, payload });
                received.emit('event');
            } else if (packet.startsWith('44')) {
                clearTimeout(timeout);
                reject(new Error('Servidor recusou a conexão Socket.IO de teste.'));
            }
        });
        socket.addEventListener('error', () => {
            clearTimeout(timeout);
            reject(new Error('Falha no transporte WebSocket de teste.'));
        });
        socket.addEventListener('close', () => {
            clearTimeout(timeout);
            if (!connected) reject(new Error('Conexão fechada antes do handshake Socket.IO.'));
        });
    });

    function waitForEvent(name, predicate = () => true) {
        const find = () => events.find(({ event, payload }) => event === name && predicate(payload));
        const existing = find();
        if (existing) return Promise.resolve(existing.payload);

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                received.off('event', check);
                reject(new Error(`Timeout aguardando evento de teste: ${name}.`));
            }, 5000);
            function check() {
                const match = find();
                if (match) {
                    clearTimeout(timeout);
                    received.off('event', check);
                    resolve(match.payload);
                }
            }
            received.on('event', check);
        });
    }

    async function close() {
        if (socket.readyState === WebSocket.CLOSED) return;
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Timeout fechando WebSocket de teste.')), 5000);
            socket.addEventListener('close', () => {
                clearTimeout(timeout);
                resolve();
            }, { once: true });
            socket.close();
        });
    }

    function waitForClose(timeoutMs = 5000) {
        if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                socket.removeEventListener('close', onClose);
                reject(new Error('Timeout aguardando o fechamento do WebSocket de teste.'));
            }, timeoutMs);

            function onClose() {
                clearTimeout(timeout);
                resolve();
            }

            socket.addEventListener('close', onClose, { once: true });
        });
    }

    return { ready, events, waitForEvent, waitForClose, close };
}

module.exports = { connectNotificationSocket };
