function chatSocket(io) {

    io.on("connection", (socket) => {

        console.log(`Socket conectado: ${socket.id}`);

        socket.on("join_conversation", (conversationId) => {

            socket.join(String(conversationId));

            console.log(
                `Socket ${socket.id} entrou na conversa ${conversationId}`
            );
        });

        socket.on("disconnect", () => {

            console.log(
                `Socket desconectado: ${socket.id}`
            );
        });

    });

}

module.exports = chatSocket;