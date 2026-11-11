const otpService = require('../services/otpService');
const connect = require('../db/connect');
const notificationOutbox = require('../services/notificationOutboxService');
const uuid = require('../utils/uuid');

// Rate limit: 30s entre cada envio por usuário
const sendTimestamps = new Map();
const time_between_sends_ms = 30000;

function verifyRateLimit(user_id) {
    const lastSend = sendTimestamps.get(user_id);
    if (lastSend) {
        const timePassed = Date.now() - lastSend;
        if (timePassed < time_between_sends_ms) {
            const secondsLeft = Math.ceil((time_between_sends_ms - timePassed) / 1000);
            return secondsLeft;
        }
    }
    sendTimestamps.set(user_id, Date.now());
    return null;
}

const sendCode = async (req, res) => {
    try {
        const { id } = req.body;

        if (!id) return res.status(400).json({ error: 'ID do usuário é obrigatório.' });
        if (!uuid.isValid(id)) return res.status(400).json({ error: 'ID do usuário inválido.' });

        const userId = uuid.toBin(id);

        const [rows] = await connect.promise().query(
            `SELECT email FROM user WHERE id = ?`, [userId]
        );

        if (rows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado' });

        const blocked = verifyRateLimit(id);
        if (blocked !== null) {
            return res.status(429).json({
                error: `Aguarde ${blocked}s antes de solicitar um novo código`
            });
        }

        await otpService.sendOtp(userId, rows[0].email);

        return res.status(200).json({ message: 'Código enviado para o email' });
    } catch (err) {
        console.error('Erro em sendCode:', err);
        return res.status(500).json({ error: 'Erro interno ao enviar o código.' });
    }
};

const verifyCode = async (req, res) => {
    try {
        const { id, code } = req.body;

        if (!id || !code) return res.status(400).json({ error: 'ID do usuário e código são obrigatórios.' });
        if (!uuid.isValid(id)) return res.status(400).json({ error: 'ID do usuário inválido.' });

        const conn = await connect.promise().getConnection();
        let entry;
        try {
            await conn.beginTransaction();
            const result = await otpService.verifyOtp(uuid.toBin(id), String(code), conn);
            if (!result.valid) {
                await conn.rollback();
                return res.status(401).json({ error: result.motive });
            }
            await conn.query("UPDATE `user` SET status = 'active' WHERE id = ?", [uuid.toBin(id)]);
            entry = await notificationOutbox.enqueue(conn, {
                id_user: id,
                type: 'sistema',
                title: 'Conta ativada',
                content: 'Seu e-mail foi confirmado e sua conta está ativa.'
            });
            await conn.commit();
        } catch (error) {
            await conn.rollback();
            throw error;
        } finally { conn.release(); }
        await notificationOutbox.flush([entry]);

        return res.status(200).json({
            message: "Email confirmado! Faça seu login!"
        });
    } catch (err) {
        console.error('Erro em verifyCode:', err);
        return res.status(500).json({ error: 'Erro interno ao verificar o código.' });
    }
};

module.exports = { sendCode, verifyCode };
