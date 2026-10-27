const chatSocket = require("./chatSocket");
const { notificationSocket } = require("./notificationSocket");

function startSockets(io) {
    notificationSocket(io);
    chatSocket(io);
}

module.exports = startSockets;