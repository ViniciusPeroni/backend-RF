const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = require("./index");
const iniciarSockets = require("./sockets");
const { startNotificationRetryWorker } = require("./services/notificationService");

const PORT = process.env.PORT || 5000;

const allowedOrigins = [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    process.env.FRONTEND_URL
].filter(Boolean);

const corsOptions = {
    origin: (origin, callback) => {
        // Permite requisições sem origin (como mobile apps ou curl) ou se estiver na lista/localhost
        if (!origin || allowedOrigins.includes(origin) || origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:")) {
            callback(null, true);
        } else {
            callback(null, true); // Permite em desenvolvimento/túnel
        }
    },
    credentials: true
};

// CORS do Express
app.use(cors(corsOptions));

// Cria o servidor HTTP usando o Express
const httpServer = http.createServer(app);

// Cria o Socket.IO sobre o mesmo servidor HTTP
const io = new Server(httpServer, {
    cors: corsOptions
});

// Registra os eventos do Socket.IO
iniciarSockets(io);

// Reprocessa notificações que falharam depois da operação de domínio.
startNotificationRetryWorker();

// Inicia o servidor
httpServer.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});