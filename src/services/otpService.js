const connect = require('../db/connect');
const generateOtp = require('../utils/generateOtp');
const sendEmailOtp = require('../utils/sendEmailOtp');
const uuid = require("../utils/uuid");

module.exports = {

    async enviarOtp(id, email) {
        const code = generateOtp();

        // Expira em 10 minutos
        const expires_at = new Date(Date.now() + 10 * 60 * 1000);

        // Invalida OTPs anteriores do mesmo usuário
        await connect.promise().query(
            `DELETE FROM otp WHERE user_id = ?`, [id]
        );

        const id_otp = uuid.generateId(); 

        // Salva o novo OTP
        await connect.promise().query(
            `INSERT INTO otp (user_id, code, expires_at, id) VALUES (?, ?, ?)`,
            [id, code, expires_at, uuid.toBin(id_otp)]
        );

        await enviarEmailOtp(email, code);
    },

    async verifyOtp(id, informed_code) {
        const [rows] = await connect.promise().query(
            `SELECT * FROM otp 
             WHERE user_id = ? AND used = 0 AND expires_at > NOW()
             ORDER BY id DESC LIMIT 1`,
            [id]
        );

        if (rows.length === 0) return { valid: false, motive: 'Código inválido ou expirado' };

        const otp = rows[0];

        if (otp.code !== informed_code) return { validd: false, motive: 'Código incorreto' };

        // Marca como usado
        await connect.promise().query(
            `UPDATE otp SET used = 1 WHERE id = ?`, [otp.id]
        );

        return { valid: true };
    }
}