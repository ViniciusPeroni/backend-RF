const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({ //obj res entrega email
    service: 'gmail',
    // IPv4: pelo IPv6 a conexão com o Gmail travava ~20s antes de cair no IPv4.
    family: 4,
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
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta name="color-scheme" content="light">
            <title>Verificação de conta | Reaproveita Franca</title>
        </head>


        <body style="
            margin: 0;
            padding: 0;
            width: 100%;
            background-color: #f3f7f4;
            font-family: 'Manrope', Arial, Helvetica, sans-serif;
            -webkit-text-size-adjust: 100%;
        ">


        <!-- Background -->
        <table role="presentation" cellpadding="0" cellspacing="0"
            border="0" width="100%"
            style="background-color: #f3f7f4;">
            <tr>
                <td align="center" style="padding: 30px 12px;">


                    <!-- Container principal -->
                    <table role="presentation" cellpadding="0"
                        cellspacing="0" border="0" width="100%"
                        style="
                            max-width: 720px;
                            background-color: #ffffff;
                            border: 1px solid #e5eae6;
                            border-radius: 20px;
                            overflow: hidden;
                        ">


                        <!-- Header -->
                        <tr>
                            <td align="center" bgcolor="#064e3b"
                                style="
                                    background-color: #064e3b;
                                    padding: 26px 28px 22px;
                                    text-align: center;
                                ">


                                <!-- Marca horizontal -->
                                <table role="presentation"
                                    cellpadding="0" cellspacing="0"
                                    border="0">
                                    <tr>
                                        <!-- Ícone de reciclagem -->
                                        <td align="center"
                                            valign="middle"
                                            style="padding-right: 16px;">


                                            <table role="presentation"
                                                cellpadding="0"
                                                cellspacing="0"
                                                border="0">
                                                <tr>
                                                    <td align="center"
                                                        valign="middle"
                                                        width="75"
                                                        height="75"
                                                        style="
                                                            width: 75px;
                                                            height: 75px;
                                                            background-color: #ffffff;
                                                            border-radius: 20px;
                                                            color: #064e3b;
                                                            font-size: 52px;
                                                            font-weight: bold;
                                                            text-align: center;
                                                            line-height: 75px;
                                                        ">
                                                        &#9851;
                                                    </td>
                                                </tr>
                                            </table>


                                        </td>


                                        <!-- Nome do sistema -->
                                        <td align="left" valign="middle">
                                            <h1 style="
                                                margin: 0 0 4px;
                                                color: #ffffff;
                                                font-size: 28px;
                                                line-height: 34px;
                                                font-weight: 800;
                                                letter-spacing: -0.8px;
                                            ">
                                                Reaproveita
                                                <span style="color: #6ee7b7;">
                                                    Franca
                                                </span>
                                            </h1>


                                            <p style="
                                                margin: 0;
                                                color: #c3e6d8;
                                                font-size: 11px;
                                                font-weight: 600;
                                                letter-spacing: 2px;
                                                text-transform: uppercase;
                                            ">
                                                ECONOMIA CIRCULAR
                                            </p>
                                        </td>
                                    </tr>
                                </table>


                                <!-- Elementos temáticos -->
                                <table role="presentation"
                                    cellpadding="0" cellspacing="0"
                                    border="0"
                                    style="margin-top: 22px;">
                                    <tr>
                                        <td style="
                                            background-color: #176449;
                                            border: 1px solid #31775d;
                                            border-radius: 30px;
                                            padding: 8px 14px;
                                            color: #e1fff0;
                                            font-size: 12px;
                                        ">
                                            &#127793; Sustentabilidade
                                        </td>


                                        <td width="8"></td>


                                        <td style="
                                            background-color: #176449;
                                            border: 1px solid #31775d;
                                            border-radius: 30px;
                                            padding: 8px 14px;
                                            color: #e1fff0;
                                            font-size: 12px;
                                        ">
                                            &#9851; Reaproveitamento
                                        </td>
                                    </tr>
                                </table>


                            </td>
                        </tr>


                        <!-- Corpo -->
                        <tr>
                            <td align="center"
                                style="padding: 32px 40px 12px;">


                                <!-- Ícone de segurança -->
                                <table role="presentation"
                                    cellpadding="0" cellspacing="0"
                                    border="0">
                                    <tr>
                                        <td align="center"
                                            valign="middle"
                                            width="60"
                                            height="60"
                                            style="
                                                width: 60px;
                                                height: 60px;
                                                border-radius: 18px;
                                                background-color: #ecfdf5;
                                                color: #064e3b;
                                                font-size: 30px;
                                                text-align: center;
                                            ">
                                            &#128274;
                                        </td>
                                    </tr>
                                </table>


                                <p style="
                                    margin: 20px 0 8px;
                                    color: #059669;
                                    font-size: 11px;
                                    font-weight: 800;
                                    letter-spacing: 2px;
                                    text-transform: uppercase;
                                ">
                                    VERIFICAÇÃO DE SEGURANÇA
                                </p>


                                <h2 style="
                                    margin: 0;
                                    color: #1f2937;
                                    font-size: 27px;
                                    line-height: 36px;
                                    font-weight: 800;
                                    letter-spacing: -0.8px;
                                ">
                                    Falta só um passo!
                                </h2>


                                <p style="
                                    margin: 12px 0 0;
                                    max-width: 500px;
                                    color: #4b5563;
                                    font-size: 14px;
                                    line-height: 23px;
                                ">
                                    Estamos quase lá! Para continuar
                                    com segurança no
                                    <strong style="color: #064e3b;">
                                        Reaproveita Franca
                                    </strong>,
                                    utilize o código de verificação abaixo.
                                </p>


                            </td>
                        </tr>


                        <!-- Card OTP -->
                        <tr>
                            <td align="center"
                                style="padding: 18px 40px 10px;">


                                <table role="presentation"
                                    cellpadding="0" cellspacing="0"
                                    border="0" width="100%"
                                    style="
                                        background-color: #ecfdf5;
                                        border: 1px solid #a7f3d0;
                                        border-radius: 16px;
                                    ">
                                    <tr>
                                        <td align="center"
                                            style="padding: 20px 12px;">


                                            <p style="
                                                margin: 0 0 12px;
                                                color: #047857;
                                                font-size: 11px;
                                                font-weight: 800;
                                                letter-spacing: 2px;
                                            ">
                                                SEU CÓDIGO DE ACESSO
                                            </p>


                                            <div style="
                                                color: #064e3b;
                                                font-family: Arial, sans-serif;
                                                font-size: 38px;
                                                line-height: 48px;
                                                font-weight: 800;
                                                letter-spacing: 7px;
                                                text-align: center;
                                            ">
                                                ${codigo}
                                            </div>


                                            <table role="presentation"
                                                cellpadding="0"
                                                cellspacing="0"
                                                border="0"
                                                style="margin-top: 14px;">
                                                <tr>
                                                    <td style="
                                                        background-color: #d1fae5;
                                                        border-radius: 30px;
                                                        padding: 8px 13px;
                                                        font-size: 12px;
                                                        font-weight: 700;
                                                        color: #065f46;
                                                    ">
                                                        &#9201; Válido por 10 minutos
                                                    </td>
                                                </tr>
                                            </table>


                                        </td>
                                    </tr>
                                </table>


                            </td>
                        </tr>


                        <!-- Orientação -->
                        <tr>
                            <td align="center"
                                style="padding: 14px 40px 20px;">


                                <p style="
                                    margin: 0;
                                    color: #6b7280;
                                    font-size: 13px;
                                    line-height: 22px;
                                ">
                                    Digite o código no aplicativo para
                                    concluir sua verificação.
                                    <br>
                                    <strong style="color: #374151;">
                                        Não compartilhe este código com ninguém.
                                    </strong>
                                </p>


                            </td>
                        </tr>


                        <!-- Aviso de segurança -->
                        <tr>
                            <td style="padding: 0 40px 28px;">


                                <table role="presentation"
                                    cellpadding="0" cellspacing="0"
                                    border="0" width="100%"
                                    style="
                                        background-color: #f9fafb;
                                        border: 1px solid #e5e7eb;
                                        border-radius: 12px;
                                    ">
                                    <tr>
                                        <td valign="top"
                                            style="
                                                width: 24px;
                                                padding: 16px 0 16px 16px;
                                                color: #d97706;
                                                font-size: 18px;
                                            ">
                                            &#9432;
                                        </td>


                                        <td style="
                                            padding: 15px 16px 15px 10px;
                                        ">
                                            <p style="
                                                margin: 0 0 5px;
                                                color: #374151;
                                                font-size: 13px;
                                                font-weight: 800;
                                            ">
                                                Não solicitou este código?
                                            </p>


                                            <p style="
                                                margin: 0;
                                                color: #6b7280;
                                                font-size: 12px;
                                                line-height: 20px;
                                            ">
                                                Se você não iniciou esta
                                                verificação, pode ignorar
                                                este e-mail. Nenhuma ação
                                                adicional é necessária.
                                            </p>
                                        </td>
                                    </tr>
                                </table>


                            </td>
                        </tr>


                        <!-- Faixa institucional -->
                        <tr>
                            <td align="center"
                                bgcolor="#ecfdf5"
                                style="
                                    background-color: #ecfdf5;
                                    border-top: 1px solid #d1fae5;
                                    padding: 20px 25px;
                                ">


                                <p style="
                                    margin: 0 0 8px;
                                    font-size: 18px;
                                    line-height: 25px;
                                    font-weight: 800;
                                    color: #064e3b;
                                    letter-spacing: -0.4px;
                                ">
                                    Transformando resíduos
                                    em oportunidades.
                                </p>


                                <p style="
                                    margin: 0;
                                    color: #4b5563;
                                    font-size: 12px;
                                    line-height: 20px;
                                ">
                                    Conectando indústrias, artesãos
                                    e cooperativas por um futuro
                                    mais sustentável.
                                </p>


                                <p style="
                                    margin: 12px 0 0;
                                    color: #047857;
                                    font-size: 11px;
                                    font-weight: 800;
                                    letter-spacing: 1.2px;
                                ">
                                    &#127807; REPENSE &bull;
                                    REAPROVEITE &bull; TRANSFORME
                                </p>


                            </td>
                        </tr>


                        <!-- Footer -->
                        <tr>
                            <td align="center"
                                style="padding: 20px 24px 24px;">


                                <p style="
                                    margin: 0 0 8px;
                                    color: #064e3b;
                                    font-size: 13px;
                                    font-weight: 800;
                                ">
                                    Reaproveita Franca
                                </p>


                                <p style="
                                    margin: 0 0 12px;
                                    color: #9ca3af;
                                    font-size: 11px;
                                    line-height: 18px;
                                ">
                                    Franca, São Paulo &bull; Brasil
                                    <br>
                                    Uma nova forma de gerar valor
                                    com economia circular.
                                </p>


                                <table role="presentation"
                                    cellpadding="0" cellspacing="0"
                                    border="0" width="100%">
                                    <tr>
                                        <td style="
                                            border-top: 1px solid #e5e7eb;
                                            height: 1px;
                                            font-size: 1px;
                                        ">
                                             
                                        </td>
                                    </tr>
                                </table>


                                <p style="
                                    margin: 14px 0 0;
                                    font-size: 11px;
                                    color: #a6abb4;
                                ">
                                    &copy; ${new Date().getFullYear()}
                                    Reaproveita Franca.
                                    Todos os direitos reservados.
                                </p>


                                <p style="
                                    margin: 7px 0 0;
                                    font-size: 10px;
                                    color: #a6abb4;
                                ">
                                    Mensagem automática. Não é
                                    necessário responder.
                                </p>


                            </td>
                        </tr>


                    </table>


                    <!-- Texto externo -->
                    <p style="
                        max-width: 430px;
                        margin: 18px auto 0;
                        color: #9ca3af;
                        font-size: 11px;
                        line-height: 19px;
                        text-align: center;
                    ">
                        Este e-mail foi enviado automaticamente
                        para proteger seu acesso à plataforma
                        Reaproveita Franca.
                    </p>


                </td>
            </tr>
        </table>


        </body>
        </html>
        `
    });
}