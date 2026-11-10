const otpService = require('../services/otpService');
const connect = require('../db/connect');
const notificationService = require('../services/notificationService');
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
            `SELECT email, status FROM user WHERE id = ?`, [userId]
        );

        if (rows.length === 0) return res.status(404).json({ error: 'Usuário não encontrado' });
        if (rows[0].status !== 'awaitingForEmail') return res.status(403).json({ error: 'Esta conta não está aguardando confirmação de e-mail.' });

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

        if (!/^\d{6}$/.test(String(code))) return res.status(400).json({ error: 'Informe o código de 6 dígitos.' });
        const [users] = await connect.promise().query('SELECT status FROM `user` WHERE id = ?', [uuid.toBin(id)]);
        if (!users.length || users[0].status !== 'awaitingForEmail') return res.status(403).json({ error: 'Esta conta não está aguardando confirmação de e-mail.' });

        const result = await otpService.verifyOtp(uuid.toBin(id), String(code));

        if (!result.valid) {
            return res.status(401).json({ error: result.motive });
        }

        const [activation] = await connect.promise().query(
            `UPDATE user SET status = 'active' WHERE id = ? AND status = 'awaitingForEmail'`,
            [uuid.toBin(id)]
        );
        if (!activation.affectedRows) return res.status(403).json({ error: 'Não foi possível ativar esta conta.' });

        try {
            await notificationService.notifyUser({
                id_user: id,
                type: 'sistema',
                title: 'Conta ativada',
                content: 'Seu e-mail foi confirmado e sua conta está ativa.'
            });
        } catch (notifyError) {
            console.error('Erro ao notificar ativação da conta:', notifyError);
        }

        return res.status(200).json({
            message: "Email confirmado! Faça seu login!"
        });
    } catch (err) {
        console.error('Erro em verifyCode:', err);
        return res.status(500).json({ error: 'Erro interno ao verificar o código.' });
    }
};

module.exports = { sendCode, verifyCode };
