const app = require("./index");
const cors= require('cors');

const PORT = process.env.PORT || 5173;

const corsOptions = {
    origin: '*',
    methods: 'GET, POST, PUT, DELETE, PATCH, HEAD',
    credentials: true,
    optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));