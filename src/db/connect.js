const mysql = require("mysql2");

const pool = mysql.createPool({
    connectionLimit: 10,
    host: process.env.DB_HOST, // Seu host (ip)
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER, // Seu usuario MySQL ou root
    password: process.env.DB_PASSWORD, // Sua senha do seu User MySQL
    database: process.env.DB_NAME, // O nome do banco de dados que voce criou
});

module.exports = pool;
