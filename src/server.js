const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = require("./index");
const iniciarSockets = require("./sockets");

const PORT = process.env.PORT || 5000;

// CORS do Express
app.use(cors({
    origin: "http://localhost:3000",
    credentials: true
}));

// Cria o servidor HTTP usando o Express
const httpServer = http.createServer(app);

// Cria o Socket.IO sobre o mesmo servidor HTTP
const io = new Server(httpServer, {
    cors: {
        origin: "http://localhost:3000",
        credentials: true
    }
});

// Registra os eventos do Socket.IO
iniciarSockets(io);

// Inicia o servidor
httpServer.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});