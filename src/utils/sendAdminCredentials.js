const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

module.exports = async function enviarCredenciaisAdmin(email, senha) {
    await transporter.sendMail({
        from: `"Reaproveita Franca" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: 'Sua conta de administrador',
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
                    Bem-vindo(a)!
                </h2>

                <p style="
                    color: #666;
                    font-size: 15px;
                ">
                        Sua conta de administrador foi criada. Use os dados abaixo para fazer login:
                </p>

                <div style="
                    margin: 25px 0;
                    padding: 15px;
                    font-size: 15px;
                    color: #333;
                    background: #f0f6ff;
                    border-radius: 8px;
                    text-align: left;
                ">
                    <p style="margin: 5px 0;"><strong>Email:</strong> ${email}</p>
                    <p style="margin: 5px 0;"><strong>Senha temporária:</strong> ${senha}</p>
                </div>

                <p style="
                    color: #555;
                    font-size: 14px;
                ">
                        Guarde essa senha em um local seguro.
                </p>

                <p style="
                    color: #999;
                    font-size: 13px;
                    margin-top: 20px;
                ">
                    Se você não solicitou esta conta, pode ignorar este email.
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
