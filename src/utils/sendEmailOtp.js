const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({ //obj res entrega email
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

module.exports = async function enviarEmailOtp(email, codigo) {
    await transporter.sendMail({
        from: `"Reaproveita Franca" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: 'Seu código de verificação',
        html: `
        <div style="
            margin: 0;
            padding: 0;
            background-color: #f4f6f8;
            font-family: Arial, sans-serif;
        ">
            <div style="
                max-width: 500px;
                margin: 50px auto;
                background: #ffffff;
                border-radius: 12px;
                padding: 30px;
                box-shadow: 0 4px 15px rgba(0,0,0,0.1);
                text-align: center;
            ">
                <h2 style="
                    color: #333;
                    margin-bottom: 10px;
                ">
                    Código de Verificação
                </h2>

                <p style="
                    color: #666;
                    font-size: 15px;
                ">
                        Use o código abaixo para continuar:
                </p>

                <div style="
                    margin: 25px 0;
                    padding: 15px;
                    font-size: 28px;
                    letter-spacing: 5px;
                    font-weight: bold;
                    color: #2d89ff;
                    background: #f0f6ff;
                    border-radius: 8px;
                    display: inline-block;
                ">
                    ${codigo}
                </div>

                <p style="
                    color: #555;
                    font-size: 14px;
                ">
                        Este código expira em <strong>10 minutos</strong>.
                </p>

                <p style="
                    color: #999;
                    font-size: 13px;
                    margin-top: 20px;
                ">
                    Se você não solicitou este código, pode ignorar este email.
                </p>

                <hr style="
                    margin: 25px 0;
                    border: none;
                    border-top: 1px solid #eee;
                ">

                <p style="
                    font-size: 12px;
                    color: #aaa;
                ">
                    © ${new Date().getFullYear()} Reaproveita Franca
                </p>
            </div>
        </div>
        `
    });
}