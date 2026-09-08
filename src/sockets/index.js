const chatSocket = require("./chatSocket");

function startSockets(io) {
    chatSocket(io);
}

module.exports = startSockets;