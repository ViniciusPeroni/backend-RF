const nodemailer = require('nodemailer');
const axios = require('axios');
const { GoogleAuth } = require('google-auth-library');
const net = require('node:net');

const GENERIC_TEXT = 'Você tem uma nova notificação no Reaproveita Franca.';
const SUBJECT = 'Reaproveita Franca';

function safeError(code, terminal = false, invalidToken = false) {
    return Object.assign(new Error(code), { code, terminal, invalidToken });
}

function enabled(channel) {
    return process.env[channel === 'email' ? 'NOTIFICATION_EMAIL_ENABLED' : 'NOTIFICATION_PUSH_ENABLED'] === 'true';
}

function emailAddress(value) {
    return typeof value === 'string' && value.length <= 254 && /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(value);
}

async function bounded(promise, milliseconds) {
    let timer;
    try {
        return await Promise.race([promise, new Promise((resolve, reject) => {
            timer = setTimeout(() => reject(safeError('TRANSPORT_TIMEOUT')), milliseconds);
        })]);
    } finally { clearTimeout(timer); }
}

async function sendEmail(to) {
    if (!enabled('email')) throw safeError('CHANNEL_DISABLED');
    const host = process.env.NOTIFICATION_SMTP_HOST;
    const port = Number(process.env.NOTIFICATION_SMTP_PORT || 465);
    const from = process.env.NOTIFICATION_EMAIL_FROM;
    if (!host || /[\s/:]/.test(host) || ![465, 587].includes(port) || !emailAddress(from) ||
        !process.env.NOTIFICATION_SMTP_USER || !process.env.NOTIFICATION_SMTP_PASS) throw safeError('SMTP_CONFIGURATION');
    if (!emailAddress(to)) throw safeError('EMAIL_INVALID', true);
    let smtp, socket;
    let aborted = false;
    try {
        smtp = nodemailer.createTransport({
            host, port, secure: port === 465, requireTLS: true, family: 4,
            auth: { user: process.env.NOTIFICATION_SMTP_USER, pass: process.env.NOTIFICATION_SMTP_PASS },
            tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
            connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000, dnsTimeout: 10000,
            disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false, pool: false,
            // Manter a posse do socket permite abortar o envio efetivo, não
            // apenas parar de aguardar sendMail(). Nodemailer aplica TLS ao
            // socket conectado em 465 e STARTTLS obrigatório em 587.
            getSocket(options, callback) {
                if (aborted) return callback(safeError('SMTP_TRANSIENT'));
                socket = net.createConnection({ host: options.host, port: options.port });
                let settled = false;
                const finish = (error, connection) => {
                    if (settled) return;
                    settled = true;
                    callback(error, connection);
                };
                socket.once('connect', () => {
                    if (aborted) { socket.destroy(); return finish(safeError('SMTP_TRANSIENT')); }
                    finish(null, { connection: socket });
                });
                socket.once('error', () => finish(safeError('SMTP_TRANSIENT')));
                socket.once('close', () => finish(safeError('SMTP_TRANSIENT')));
            }
        });
        const result = await bounded(smtp.sendMail({ from, to, subject: SUBJECT, text: GENERIC_TEXT }), 30000);
        if (!result.accepted?.length) throw safeError('SMTP_REJECTED', true);
    } catch (error) {
        if (error.code === 'SMTP_REJECTED') throw error;
        const status = Number(error.responseCode);
        throw safeError(status >= 500 && error.code !== 'EAUTH' ? 'SMTP_REJECTED' : 'SMTP_TRANSIENT', status >= 500 && error.code !== 'EAUTH');
    } finally {
        aborted = true;
        if (socket) socket.destroy();
        if (smtp) smtp.close();
    }
}

async function sendPush(token) {
    if (!enabled('push')) throw safeError('CHANNEL_DISABLED');
    const project = process.env.FCM_PROJECT_ID;
    if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project || '')) throw safeError('FCM_CONFIGURATION');
    try {
        const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/firebase.messaging'], clientOptions: { timeout: 10000 } });
        const accessToken = await bounded(auth.getAccessToken(), 15000);
        if (!accessToken) throw safeError('FCM_AUTH');
        await axios.post(`https://fcm.googleapis.com/v1/projects/${project}/messages:send`, {
            message: { token, notification: { title: SUBJECT, body: GENERIC_TEXT } }
        }, {
            headers: { Authorization: `Bearer ${accessToken}` }, timeout: 10000,
            maxRedirects: 0, maxContentLength: 65536, maxBodyLength: 16384
        });
    } catch (error) {
        const details = error.response?.data?.error?.details;
        const fcm = Array.isArray(details) ? details.find(item => item['@type'] === 'type.googleapis.com/google.firebase.fcm.v1.FcmError')?.errorCode : undefined;
        if (fcm === 'UNREGISTERED' || fcm === 'INVALID_ARGUMENT') throw safeError(`FCM_${fcm}`, true, true);
        const status = Number(error.response?.status);
        if (status === 400) throw safeError('FCM_INVALID_REQUEST', true);
        // Credencial/projeto e limites podem ser corrigidos antes do próximo retry.
        throw safeError('FCM_TRANSIENT');
    }
}

module.exports = { GENERIC_TEXT, enabled, sendEmail, sendPush };
