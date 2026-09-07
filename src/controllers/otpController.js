const otpService = require('../services/otpService');
const connect = require('../db/connect');

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
    const { id } = req.body;

    if (!id) return res.status(400).json({ error: 'ID do usuário é obrigatório.' });

    const [rows] = await connect.promise().query(
        `SELECT email FROM user WHERE id = ?`, [id]
    );

    if (rows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado' });

    const blocked = verifyRateLimit(id);
    if (blocked !== null) {
        return res.status(429).json({
            error: `Aguarde ${blocked}s antes de solicitar um novo código`
        });
    }

    await otpService.sendOtp(id, rows[0].email);

    return res.status(200).json({ message: 'Código enviado para o email' });
};

const verifyCode = async (req, res) => {
    const { id, code } = req.body;

    if (!id || !code) return res.status(400).json({ error: 'ID do usuário e código são obrigatórios.' });

    const result = await otpService.verifyOtp(id, code);

    if (!result.valid) {
        return res.status(401).json({ error: result.motive });
    }

    await connect.promise().query(
        `UPDATE user SET status = 'firstLogin' WHERE id = ?`,
        [id]
    );

    return res.status(200).json({
        message: "Email confirmado! Faça seu login!"
    });
};

module.exports = { sendCode, verifyCode };