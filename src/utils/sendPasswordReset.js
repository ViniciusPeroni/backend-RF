const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

module.exports = async function enviarEmailReset(email, token) {
    // Base do link vem do .env (FRONTEND_URL) para não ficar fixa no código
    const linkRedefinicao = `${process.env.FRONTEND_URL}/redefinir-senha?token=${token}`;

    await transporter.sendMail({
        from: `"Reaproveita Franca" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: 'Sua redefinição de senha',
        html: `
        <div style="
            margin: 0;
            padding: 40px 20px;
            background-color: #f8fafc;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            -webkit-font-smoothing: antialiased;
        ">
            <div style="
                max-width: 560px;
                margin: 0 auto;
                background: #ffffff;
                border-radius: 16px;
                padding: 40px;
                box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);
                border: 1px solid #e2e8f0;
            ">
                <div style="text-align: center; margin-bottom: 32px;">
                    <h1 style="
                        color: #1e293b;
                        font-size: 24px;
                        font-weight: 700;
                        margin: 0;
                        letter-spacing: -0.5px;
                    ">
                        Reaproveita Franca
                    </h1>
                </div>

                <h2 style="
                    color: #0f172a;
                    font-size: 20px;
                    font-weight: 600;
                    margin-top: 0;
                    margin-bottom: 12px;
                ">
                    Link de redefinição
                </h2>

                <p style="
                    color: #475569;
                    font-size: 15px;
                    line-height: 24px;
                    margin: 0 0 32px 0;
                ">
                    Olá! Recebemos uma solicitação para redefinir a senha da sua conta. Clique no botão abaixo para prosseguir (válido por 30 minutos):
                </p>

                <div style="text-align: center; margin-bottom: 32px;">
                    <a href="${linkRedefinicao}" target="_blank" style="
                        background-color: #3b82f6;
                        color: #ffffff;
                        padding: 14px 28px;
                        text-decoration: none;
                        font-size: 15px;
                        font-weight: 600;
                        border-radius: 8px;
                        display: inline-block;
                        box-shadow: 0 4px 12px rgba(59, 130, 246, 0.25);
                    ">
                        Redefinir senha
                    </a>
                </div>

                <p style="
                    color: #64748b;
                    font-size: 13px;
                    line-height: 20px;
                    margin: 0 0 24px 0;
                    text-align: center;
                ">
                    Se o botão acima não funcionar, copie e cole o link abaixo no seu navegador:<br>
                    <a href="${linkRedefinicao}" style="color: #3b82f6; text-decoration: underline; word-break: break-all;">
                        ${linkRedefinicao}
                    </a>
                </p>

                <p style="
                    color: #94a3b8;
                    font-size: 13px;
                    line-height: 20px;
                    margin: 0;
                    border-top: 1px solid #f1f5f9;
                    padding-top: 24px;
                ">
                    Se você não solicitou a redefinição de senha, pode ignorar este e-mail.
                </p>

                <div style="
                    text-align: center;
                    margin-top: 40px;
                ">
                    <p style="
                        font-size: 12px;
                        color: #94a3b8;
                        margin: 0;
                    ">
                        &copy; ${new Date().getFullYear()} Reaproveita Franca
                    </p>
                </div>
            </div>
        </div>
        `
    });
}
