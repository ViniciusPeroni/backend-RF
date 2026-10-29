const jwt = require('jsonwebtoken');

let ioInstance = null;

function userRoom(id_user) {
    return `user:${String(id_user).toLowerCase()}`;
}

function extractToken(socket) {
    const authToken = socket.handshake.auth && socket.handshake.auth.token;
    const queryToken = socket.handshake.query && socket.handshake.query.token;
    const header = socket.handshake.headers && socket.handshake.headers.authorization;
    const headerToken = header && header.startsWith('Bearer ') ? header.slice(7) : header;

    return authToken || queryToken || headerToken || null;
}

function getDecodedToken(token) {
    if (!token) return null;

    try {
        return jwt.verify(token, process.env.SECRET);
    } catch (err) {
        return null;
    }
}

function getUserIdFromToken(token) {
    const decoded = getDecodedToken(token);

    return decoded ? decoded.id : null;
}

function emitToUser(id_user, event, payload) {
    if (!ioInstance || !id_user) return;

    ioInstance.to(userRoom(id_user)).emit(event, payload);
}

function notificationSocket(io) {
    ioInstance = io;

    io.on('connection', (socket) => {
        const decoded = getDecodedToken(extractToken(socket));

        if (!decoded) return;

        socket.userId = decoded.id;
        socket.userName = decoded.name;

        socket.join(userRoom(decoded.id));
    });
}

module.exports = {
    notificationSocket,
    emitToUser,
    userRoom,
    extractToken,
    getDecodedToken,
    getUserIdFromToken
};
