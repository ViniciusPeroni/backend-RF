const otpService = require('../services/otpService');
const connect = require("../db/connect");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const crypto = require("crypto");
const uuid = require('../utils/uuid');
const doc = require('../services/docService');
const loc = require('../services/localizationService');
const notificationOutbox = require('../services/notificationOutboxService');
const generatePassword = require('../utils/generateRandomPassword');
const enviarCredenciaisAdmin = require('../utils/sendAdminCredentials');
const enviarEmailReset = require('../utils/sendPasswordReset');

const VALID_ROLES = ['user', 'company', 'admin'];
const VALID_STATUS = ['inactive', 'awaitingForEmail', 'active'];

function isValidEmail(email) {
    return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function welcomeNotification(id_user, role) {
    return {
        id_user, type: 'sistema', title: 'Bem-vindo(a) ao Reaproveita Franca',
        content: role === 'company'
            ? 'Sua empresa foi cadastrada. Confirme seu e-mail, se necessário, para acessar a conta.'
            : 'Sua conta foi criada. Confirme seu e-mail, se necessário, para acessar a conta.'
    };
}

const createUser = async (req, res) => {
    const { cpf, name, email, password, cellphone, birthday, zip_code, street, neighborhood, number, city, state } = req.body;
    const photo = req.file ? req.file.buffer : null;

    if (!cpf || !name || !email || !password || !cellphone || !birthday || !zip_code || !street || !neighborhood || !number || !city || !state) {
        return res.status(400).json({ error: 'Todos os campos são obrigatórios.' });
    }

    const role = req.body.role || 'user';

    if (!VALID_ROLES.includes(role)) {
        return res.status(400).json({ error: 'Role inválida. Use: user, company ou admin.' });
    }

    if (!isValidEmail(email)) {
        return res.status(400).json({ error: 'Email inválido.' });
    }

    if (password.length < 6) {
        return res.status(400).json({ error: 'A senha deve ter no mínimo 6 caracteres.' });
    }

    if (!/^\d{11}$/.test(cellphone)) {
        return res.status(400).json({ error: 'Celular inválido. Informe 11 dígitos numéricos (DDD + número).' });
    }

    const id = uuid.generateId();

    // Transação (opção A): os 3 inserts (user, document, localization) usam a
    // MESMA conexão. Se qualquer um falhar, o ROLLBACK desfaz todos — sem órfãos.
    // O e-mail é enviado DEPOIS do commit, pois SMTP não tem rollback.
    let conn;
    let welcome;
    try {
        conn = await connect.promise().getConnection();
        await conn.beginTransaction();

        const [exists] = await conn.query(
            `SELECT id FROM \`user\` WHERE email = ?`,
            [email]
        );

        if (exists.length > 0) {
            const err = new Error('Email já cadastrado.');
            err.status = 409;
            throw err;
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        await conn.query(
            `INSERT INTO \`user\` (id, role, name, email, password, cellphone, photo)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [uuid.toBin(id), role, name, email, hashedPassword, cellphone, photo]
        );

        await doc.createDoc({ userId: id, docType: 'CPF', doc: cpf }, conn);

        await loc.createLocalization({
            userId: id,
            zipCode: zip_code,
            street,
            neighborhood,
            number,
            city,
            state
        }, conn);

        welcome = await notificationOutbox.enqueue(conn, welcomeNotification(id, role));
        await conn.commit();
    } catch (error) {
        if (conn) {
            try { await conn.rollback(); } catch (rbError) {
                console.error('Falha no rollback do signup:', rbError);
            }
        }
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'Email já cadastrado.' });
        }
        if (error.message === 'Documento já registrado') {
            return res.status(409).json({ error: error.message });
        }
        if (error.status) {
            return res.status(error.status).json({ error: error.message });
        }
        return res.status(500).json({ error: 'Erro ao criar usuário.' });
    } finally {
        if (conn) conn.release();
    }

    let emailSent = true;
    try {
        await otpService.sendOtp(id, email);
    } catch (emailError) {
        console.error('OTP não enviado após signup:', emailError.message);
        emailSent = false;
    }

    await notificationOutbox.flush([welcome]);

    return res.status(201).json({
        message: emailSent
            ? 'Usuário criado com sucesso. Confirme o email para ativar a conta.'
            : 'Usuário criado, mas o e-mail de confirmação falhou. Solicite um novo código.',
        id,
        emailSent
    });
};

const createCompany = async (req, res) => {
    const { cpf, name, email, cnpj, password, cellphone, zip_code, street, neighborhood, number, city, state } = req.body;
    const photo = req.file ? req.file.buffer : null;
    const googleIdentity = req.googleIdentity;

    if (!cpf || !name || !email || !cnpj || (!googleIdentity && !password) || !cellphone || !zip_code || !street || !neighborhood || !number || !city || !state) {
        return res.status(400).json({ error: 'Todos os campos são obrigatórios.' });
    }

    if ([cpf, name, email, cnpj, cellphone, zip_code, street, neighborhood, number, city, state].some(value => typeof value !== 'string' || !value.trim())) return res.status(400).json({ error: 'Informe os dados da empresa em texto.' });
    if (!/^\d{11}$/.test(cpf) || !/^\d{14}$/.test(cnpj) || !/^\d{8}$/.test(zip_code) || !/^[A-Za-z]{2}$/.test(state) || name.length > 100 || email.length > 255 || number.length > 6) return res.status(400).json({ error: 'Confira os documentos e o endereço da empresa.' });
    const role = 'company';

    if (!VALID_ROLES.includes(role)) {
        return res.status(400).json({ error: 'Role inválida. Use: user, company ou admin.' });
    }

    if (!isValidEmail(email)) {
        return res.status(400).json({ error: 'Email inválido.' });
    }

    if (!googleIdentity && (typeof password !== 'string' || password.length < 6)) {
        return res.status(400).json({ error: 'A senha deve ter no mínimo 6 caracteres.' });
    }

    if (!/^\d{11}$/.test(cellphone)) {
        return res.status(400).json({ error: 'Celular inválido. Informe 11 dígitos numéricos (DDD + número).' });
    }

    const id = uuid.generateId();

    // Transação (opção A): os 3 inserts (user, document, localization) usam a
    // MESMA conexão. Se qualquer um falhar, o ROLLBACK desfaz todos — sem órfãos.
    // O e-mail é enviado DEPOIS do commit, pois SMTP não tem rollback.
    let conn;
    let welcome;
    try {
        conn = await connect.promise().getConnection();
        await conn.beginTransaction();

        const [exists] = await conn.query(
            `SELECT id FROM \`user\` WHERE email = ?`,
            [email]
        );

        if (exists.length > 0) {
            const err = new Error('Email já cadastrado.');
            err.status = 409;
            throw err;
        }

        if (googleIdentity) {
            const [linked] = await conn.query('SELECT id FROM `user` WHERE google_id = ?', [googleIdentity.sub]);
            if (linked.length) { const error = new Error('Conta vinculada a outro acesso Google.'); error.status = 409; throw error; }
        }
        const hashedPassword = googleIdentity ? null : await bcrypt.hash(password, 10);

        await conn.query(
            `INSERT INTO \`user\` (id, role, name, email, password, cellphone, photo, google_id, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [uuid.toBin(id), role, name, email, hashedPassword, cellphone, photo, googleIdentity?.sub || null, googleIdentity ? 'active' : 'awaitingForEmail']
        );

        await doc.createDoc({ userId: id, docType: 'CPF', doc: cpf }, conn);
        await doc.createDoc({ userId: id, docType: 'CNPJ', doc: cnpj }, conn);

        await loc.createLocalization({
            userId: id,
            zipCode: zip_code,
            street,
            neighborhood,
            number,
            city,
            state
        }, conn);

        welcome = await notificationOutbox.enqueue(conn, welcomeNotification(id, role));
        await conn.commit();
    } catch (error) {
        if (conn) {
            try { await conn.rollback(); } catch (rbError) {
                console.error('Falha no rollback do signup:', rbError);
            }
        }
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'Email já cadastrado.' });
        }
        if (error.message === 'Documento já registrado') {
            return res.status(409).json({ error: error.message });
        }
        if (error.status) {
            return res.status(error.status).json({ error: error.message });
        }
        return res.status(500).json({ error: 'Erro ao criar usuário.' });
    } finally {
        if (conn) conn.release();
    }

    if (googleIdentity) {
        const user = { id, role, name, email, status: 'active' };
        await notificationOutbox.flush([welcome]);
        return res.status(201).json({ message: 'Empresa criada com Google.', token: issueSocialToken(user), user, mustChangePassword: false });
    }

    let emailSent = true;
    try {
        await otpService.sendOtp(id, email);
    } catch (emailError) {
        console.error('OTP não enviado após signup:', emailError.message);
        emailSent = false;
    }

    await notificationOutbox.flush([welcome]);

    return res.status(201).json({
        message: emailSent
            ? 'Empresa criada com sucesso. Confirme o email para ativar a conta.'
            : 'Empresa criada, mas o e-mail de confirmação falhou. Solicite um novo código.',
        id,
        emailSent
    });
};

const createAdmin = async (req, res) => {
    const { cpf, name, email, cellphone, birthday, zip_code, street, neighborhood, number, city, state } = req.body;
    const photo = req.file ? req.file.buffer : null;

    if (!cpf || !name || !email || !cellphone || !birthday || !zip_code || !street || !neighborhood || !number || !city || !state) {
        return res.status(400).json({ error: 'Todos os campos são obrigatórios.' });
    }

    const role = 'admin';

    if (!isValidEmail(email)) {
        return res.status(400).json({ error: 'Email inválido.' });
    }

    if (!/^\d{11}$/.test(cellphone)) {
        return res.status(400).json({ error: 'Celular inválido. Informe 11 dígitos numéricos (DDD + número).' });
    }

    const id = uuid.generateId();

    // A senha é gerada aqui e nunca vem do body: quem cria o admin
    // não tem acesso a ela. Só o hash é salvo no banco.
    const adminPassword = generatePassword();

    // Transação (opção A): os 3 inserts (user, document, localization) usam a
    // MESMA conexão. Se qualquer um falhar, o ROLLBACK desfaz todos — sem órfãos.
    // O e-mail é enviado DEPOIS do commit, pois SMTP não tem rollback.
    let conn;
    try {
        conn = await connect.promise().getConnection();
        await conn.beginTransaction();

        const [exists] = await conn.query(
            `SELECT id FROM \`user\` WHERE email = ?`,
            [email]
        );

        if (exists.length > 0) {
            const err = new Error('Email já cadastrado.');
            err.status = 409;
            throw err;
        }

        const hashedPassword = await bcrypt.hash(adminPassword, 10);

        await conn.query(
            `INSERT INTO \`user\` (id, role, name, email, password, cellphone, photo, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'firstLogin')`,
            [uuid.toBin(id), role, name, email, hashedPassword, cellphone, photo]
        );

        await doc.createDoc({ userId: id, docType: 'CPF', doc: cpf }, conn);

        await loc.createLocalization({
            userId: id,
            zipCode: zip_code,
            street,
            neighborhood,
            number,
            city,
            state
        }, conn);

        await conn.commit();
    } catch (error) {
        if (conn) {
            try { await conn.rollback(); } catch (rbError) {
                console.error('Falha no rollback do signup:', rbError);
            }
        }
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'Email já cadastrado.' });
        }
        if (error.message === 'Documento já registrado') {
            return res.status(409).json({ error: error.message });
        }
        if (error.status) {
            return res.status(error.status).json({ error: error.message });
        }
        return res.status(500).json({ error: 'Erro ao criar usuário.' });
    } finally {
        if (conn) conn.release();
    }

    // Envia as credenciais (email + senha gerada) ao novo admin.
    // A senha em texto nunca volta na resposta nem fica visível
    // para quem criou a conta — só o hash foi salvo no banco.
    let credentialsSent = true;
    try {
        await enviarCredenciaisAdmin(email, adminPassword);
    } catch (emailError) {
        console.error('Credenciais não enviadas ao novo admin:', emailError.message);
        credentialsSent = false;
    }

    return res.status(201).json({
        message: credentialsSent
            ? 'Admin criado com sucesso. As credenciais foram enviadas para o email.'
            : 'Admin criado, mas o e-mail com as credenciais falhou. Solicite o reenvio.',
        id,
        credentialsSent
    });
};

const loginUser = async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email e senha são obrigatórios.' });
    }

    try {
        const [rows] = await connect.promise().query(
            `SELECT BIN_TO_UUID(id) AS id, role, name, password, status
             FROM \`user\` WHERE email = ?`,
            [email]
        );

        if (rows.length === 0) {
            return res.status(401).json({ error: 'Email ou senha incorretos.' });
        }

        const user = rows[0];

        // Conta criada só via login social (password NULL): não tem senha local.
        if (!user.password) {
            return res.status(401).json({ error: 'Conta criada via login social. Use login com Google ou LinkedIn.' });
        }

        const validPassword = await bcrypt.compare(password, user.password);

        if (!validPassword) {
            return res.status(401).json({ error: 'Email ou senha incorretos.' });
        }

        if (user.status !== 'active' && user.status !== 'firstLogin') {
            if (user.status === 'awaitingForEmail') return res.status(403).json({ error: 'Conta ainda não ativada. Confirme seu email.', code: 'EMAIL_VERIFICATION_REQUIRED', verification: { id: user.id, email } });
            return res.status(403).json({ error: 'Conta inativa. Entre em contato com o suporte.' });
        }

        const token = jwt.sign(
            { id: user.id, role: user.role, name: user.name },
            process.env.SECRET,
            { expiresIn: '8h' }
        );

        delete user.password;

        return res.status(200).json({
            message: 'Login realizado com sucesso.',
            token,
            user,
            mustChangePassword: user.status === 'firstLogin'
        });
    } catch (error) {
        return res.status(500).json({ error: 'Erro ao realizar login.' });
    }
};

// ======================================================
// --------     Login social (Google + LinkedIn)
// Sem photo_url: foto do provedor é ignorada.
// ======================================================
function issueSocialToken(user) {
    return jwt.sign(
        { id: user.id, role: user.role, name: user.name },
        process.env.SECRET,
        { expiresIn: '8h' }
    );
}

// Login-ou-cadastro: procura pelo id do provedor, senão linka pelo
// email, senão cria conta mínima ativa (sem senha/celular/CPF).
async function findOrCreateSocialUser({ provider, providerId, email, name }) {
    const column = provider === 'google' ? 'google_id' : 'linkedin_id';

    const [byProvider] = await connect.promise().query(
        `SELECT BIN_TO_UUID(id) AS id, role, name, email, status
         FROM \`user\` WHERE \`${column}\` = ? LIMIT 1`,
        [providerId]
    );

    if (byProvider.length > 0) {
        const user = byProvider[0];
        // Provedor já verificou o email: garante conta ativa.
        if (user.status !== 'active' && user.status !== 'firstLogin') {
            await connect.promise().query(
                `UPDATE \`user\` SET status = 'active' WHERE \`${column}\` = ?`,
                [providerId]
            );
            user.status = 'active';
        }
        return user;
    }

    const [byEmail] = await connect.promise().query(
        `SELECT BIN_TO_UUID(id) AS id, role, name, email, status
         FROM \`user\` WHERE email = ? LIMIT 1`,
        [email]
    );

    if (byEmail.length > 0) {
        const user = byEmail[0];
        await connect.promise().query(
            `UPDATE \`user\`
             SET \`${column}\` = ?,
                 status = CASE WHEN status IN ('active','firstLogin') THEN status ELSE 'active' END
             WHERE email = ?`,
            [providerId, email]
        );
        if (user.status !== 'active' && user.status !== 'firstLogin') {
            user.status = 'active';
        }
        user[column] = providerId;
        return user;
    }

    const id = uuid.generateId();
    const safeName = (typeof name === 'string' && name.trim())
        ? name.trim().slice(0, 100)
        : String(email).split('@')[0].slice(0, 100);

    const conn = await connect.promise().getConnection();
    let welcome;
    try {
        await conn.beginTransaction();
        await conn.query(
            `INSERT INTO \`user\` (id, role, name, email, password, cellphone, status, \`${column}\`)
             VALUES (?, 'user', ?, ?, NULL, NULL, 'active', ?)`,
            [uuid.toBin(id), safeName, email, providerId]
        );
        welcome = await notificationOutbox.enqueue(conn, welcomeNotification(id, 'user'));
        await conn.commit();
    } catch (error) {
        await conn.rollback();
        throw error;
    } finally { conn.release(); }
    await notificationOutbox.flush([welcome]);

    return { id, role: 'user', name: safeName, email, status: 'active', [column]: providerId };
}

// POST /user/login/google — Opção A (ID Token, sem OAuth completo)
const loginGoogle = async (req, res) => {
    let payload;
    try { payload = await require('../services/googleIdentityService').verifyGoogleIdentity(req.body?.idToken || req.body?.credential); }
    catch (error) { return res.status([400, 401, 403, 503].includes(error.status) ? error.status : 500).json({ error: error.status ? error.message : 'Não foi possível validar o Google.' }); }
    try {
        const { user, notifications } = await require('../services/googleLoginService').findOrCreateGoogleUser(payload, 0, req.body.accountType === 'company');
        await notificationOutbox.flush(notifications || []);
        const token = issueSocialToken(user);
        return res.status(200).json({ message: 'Login com Google realizado com sucesso.', token, user, mustChangePassword: user.status === 'firstLogin' });
    } catch (error) {
        if ([403, 404, 409].includes(error.status)) return res.status(error.status).json({ error: error.message });
        return res.status(500).json({ error: 'Não foi possível concluir o acesso com Google. Tente novamente.' });
    }
};

// GET /user/login/linkedin — devolve a URL de autorização (OAuth2 + OIDC, gratuito)
const linkedinAuthUrl = async (req, res) => {
    const clientId = process.env.LINKEDIN_CLIENT_ID;
    const redirectUri = process.env.LINKEDIN_REDIRECT_URI;

    if (!clientId || !redirectUri) {
        return res.status(500).json({ error: 'Login LinkedIn não configurado.' });
    }

    const state = crypto.randomBytes(16).toString('hex');
    const scope = encodeURIComponent('openid profile email');
    const url =
        `https://www.linkedin.com/oauth/v2/authorization` +
        `?response_type=code` +
        `&client_id=${encodeURIComponent(clientId)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&scope=${scope}` +
        `&state=${state}`;

    return res.status(200).json({ url, state });
};

function decodeJwtPayload(idToken) {
    try {
        const parts = String(idToken).split('.');
        if (parts.length < 2) return null;
        const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        return JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
    } catch {
        return null;
    }
}

// GET /user/login/linkedin/callback?code=... (ou POST com { code })
const linkedinCallback = async (req, res) => {
    const code = req.query.code || req.body.code;

    if (!code) {
        return res.status(400).json({ error: 'Parâmetro code é obrigatório.' });
    }

    const clientId = process.env.LINKEDIN_CLIENT_ID;
    const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
    const redirectUri = process.env.LINKEDIN_REDIRECT_URI;

    if (!clientId || !clientSecret || !redirectUri) {
        return res.status(500).json({ error: 'Login LinkedIn não configurado.' });
    }

    try {
        // 1) Troca o code por access_token (+ id_token OIDC). Gratuito, sem lib paga.
        const tokenRes = await axios.post(
            'https://www.linkedin.com/oauth/v2/accessToken',
            new URLSearchParams({
                grant_type: 'authorization_code',
                code: String(code),
                redirect_uri: redirectUri,
                client_id: clientId,
                client_secret: clientSecret,
            }).toString(),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 }
        );

        const { access_token, id_token } = tokenRes.data || {};

        if (!access_token) {
            return res.status(401).json({ error: 'Não foi possível autenticar com o LinkedIn.' });
        }

        // 2) Busca identidade verificada no endpoint OpenID userinfo.
        let sub;
        let email;
        let emailVerified;
        let name;

        try {
            const meRes = await axios.get('https://api.linkedin.com/v2/userinfo', {
                headers: { Authorization: `Bearer ${access_token}` },
                timeout: 15000,
            });
            sub = meRes.data.sub;
            email = meRes.data.email;
            emailVerified = meRes.data.email_verified;
            name = meRes.data.name
                || [meRes.data.given_name, meRes.data.family_name].filter(Boolean).join(' ');
        } catch (userinfoError) {
            console.error('Falha no userinfo LinkedIn, tentando id_token:', userinfoError.message);
        }

        // Fallback: decodifica o id_token (JWT assinado pelo LinkedIn).
        if ((!sub || !email) && id_token) {
            const decoded = decodeJwtPayload(id_token);
            if (decoded) {
                sub = sub || decoded.sub;
                email = email || decoded.email;
                emailVerified = emailVerified ?? decoded.email_verified;
                name = name || decoded.name;
            }
        }

        if (!sub || !email) {
            return res.status(401).json({ error: 'LinkedIn não retornou identidade válida.' });
        }

        // Mesmo rigor do Google: só linka se o email foi verificado.
        if (emailVerified === false || emailVerified === 'false') {
            return res.status(403).json({ error: 'E-mail do LinkedIn não verificado.' });
        }

        const user = await findOrCreateSocialUser({
            provider: 'linkedin',
            providerId: String(sub),
            email: String(email),
            name,
        });

        if (user.status !== 'active' && user.status !== 'firstLogin') {
            return res.status(403).json({ error: 'Conta ainda não ativada.' });
        }

        const token = issueSocialToken(user);

        return res.status(200).json({
            message: 'Login com LinkedIn realizado com sucesso.',
            token,
            user,
            mustChangePassword: false,
        });
    } catch (error) {
        const detail = error.response ? error.response.data : error.message;
        console.error('Erro em linkedinCallback:', detail);
        return res.status(401).json({ error: 'Falha na autenticação com o LinkedIn.' });
    }
};

const getAllUsers = async (req, res) => {
    try {
        const [rows] = await connect.promise().query(
            `SELECT BIN_TO_UUID(id) AS id, role, name, email, cellphone, birthday, status, created_in AS createdIn
             FROM \`user\` ORDER BY created_in DESC LIMIT 100`
        );
        return res.status(200).json(rows);
    } catch (error) {
        console.error('Erro em getAllUsers:', error);
        return res.status(500).json({ error: 'Erro ao listar usuários.' });
    }
};

const getUsersByName = async (req, res) => {
    const { name } = req.params;

    if (!name || !String(name).trim()) {
        return res.status(400).json({ error: 'Informe o parâmetro name para buscar.' });
    }

    try {
        const [rows] = await connect.promise().query(
            `SELECT BIN_TO_UUID(id) AS id, role, name, email, cellphone, birthday, status, created_in AS createdIn
             FROM \`user\` WHERE name LIKE ? ORDER BY name ASC LIMIT 100`,
            [`%${String(name).trim()}%`]
        );
        return res.status(200).json(rows);
    } catch (error) {
        console.error('Erro em getUsersByName:', error);
        return res.status(500).json({ error: 'Erro ao buscar usuários.' });
    }
};

const updateUser = async (req, res) => {
    try {
        const { id } = req.params;

        if (!uuid.isValid(id)) {
            return res.status(400).json({ error: 'ID do usuário inválido.' });
        }

        // Somente o dono da conta ou um admin podem atualizar.
        if (req.role !== 'admin' && String(req.userId).toLowerCase() !== String(id).toLowerCase()) {
            return res.status(403).json({ error: 'Acesso negado.' });
        }

        // role, status, email e password NÃO são atualizáveis por esta rota
        // (têm fluxos próprios). Se vierem no body, são ignorados.
        const { name, cellphone, birthday } = req.body;
        const fields = {};

        if (name !== undefined) {
            if (typeof name !== 'string' || !name.trim()) {
                return res.status(400).json({ error: 'Nome inválido.' });
            }
            fields.name = name.trim();
        }

        if (cellphone !== undefined) {
            if (!/^\d{11}$/.test(cellphone)) {
                return res.status(400).json({ error: 'Celular inválido. Informe 11 dígitos numéricos (DDD + número).' });
            }
            fields.cellphone = cellphone;
        }

        if (birthday !== undefined) {
            if (isNaN(Date.parse(birthday))) {
                return res.status(400).json({ error: 'Data de nascimento inválida. Use YYYY-MM-DD.' });
            }
            fields.birthday = birthday;
        }

        if (req.file) {
            if (req.file.size > 5 * 1024 * 1024) return res.status(413).json({ error: 'A foto deve ter até 5 MB.' });
            if (!require('../utils/imageType')(req.file.buffer)) return res.status(415).json({ error: 'Escolha uma foto JPG, PNG, WebP ou GIF.' });
            fields.photo = req.file.buffer;
        }

        if (Object.keys(fields).length === 0) {
            return res.status(400).json({ error: 'Nenhum campo para atualizar. Envie name, cellphone, birthday ou photo.' });
        }

        const [exists] = await connect.promise().query(
            `SELECT id FROM \`user\` WHERE id = ?`,
            [uuid.toBin(id)]
        );

        if (exists.length === 0) {
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }

        const setClause = Object.keys(fields).map((f) => `\`${f}\` = ?`).join(', ');
        await connect.promise().query(
            `UPDATE \`user\` SET ${setClause} WHERE id = ?`,
            [...Object.values(fields), uuid.toBin(id)]
        );

        const [rows] = await connect.promise().query(
            `SELECT BIN_TO_UUID(id) AS id, role, name, email, cellphone, birthday, status, created_in AS createdIn
             FROM \`user\` WHERE id = ?`,
            [uuid.toBin(id)]
        );

        return res.status(200).json({
            message: 'Usuário atualizado com sucesso.',
            user: rows[0]
        });
    } catch (error) {
        console.error('Erro em updateUser:', error);
        return res.status(500).json({ error: 'Erro ao atualizar usuário.' });
    }
};

const deleteUser = async (req, res) => {
    try {
        const { id } = req.params;

        if (!uuid.isValid(id)) {
            return res.status(400).json({ error: 'ID do usuário inválido.' });
        }

        // Somente o dono da conta ou um admin podem excluir.
        if (req.role !== 'admin' && String(req.userId).toLowerCase() !== String(id).toLowerCase()) {
            return res.status(403).json({ error: 'Acesso negado.' });
        }

        const [exists] = await connect.promise().query(
            `SELECT id FROM \`user\` WHERE id = ?`,
            [uuid.toBin(id)]
        );

        if (exists.length === 0) {
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }

        await connect.promise().query(
            `DELETE FROM \`user\` WHERE id = ?`,
            [uuid.toBin(id)]
        );

        return res.status(200).json({
            message: 'Usuário excluído com sucesso.'
        });
    } catch (error) {
        console.error('Erro em deleteUser:', error);
        if (error.code === 'ER_ROW_IS_REFERENCED_2') {
            return res.status(409).json({ error: 'Não é possível excluir: o usuário possui vínculos (conversas, compras etc.).' });
        }
        return res.status(500).json({ error: 'Erro ao excluir usuário.' });
    }
};

// Authenticated image read; photos never become public URLs.
const getUserPhoto = async (req, res) => {
    const { id } = req.params;
    res.set('Cache-Control', 'private, no-store');
    if (!uuid.isValid(id)) return res.status(400).json({ error: 'ID do usuário inválido.' });
    if (req.role !== 'admin' && String(req.userId).toLowerCase() !== id.toLowerCase()) return res.status(403).json({ error: 'Acesso negado.' });
    try {
        const [rows] = await connect.promise().query('SELECT photo FROM `user` WHERE id = ?', [uuid.toBin(id)]);
        if (!rows.length) return res.status(404).json({ error: 'Usuário não encontrado.' });
        const photo = rows[0].photo;
        if (!photo || !photo.length) return res.status(204).end();
        const type = require('../utils/imageType')(photo);
        if (!type) return res.status(415).json({ error: 'Formato de foto não suportado.' });
        res.set('X-Content-Type-Options', 'nosniff');
        return res.type(type).send(photo);
    } catch {
        return res.status(500).json({ error: 'Não foi possível consultar a foto.' });
    }
};

const getUserById = async (req, res) => {
    try {
        const { id } = req.params;

        if (!uuid.isValid(id)) {
            return res.status(400).json({ error: 'ID do usuário inválido.' });
        }

        // Somente o dono da conta ou um admin podem visualizar.
        if (req.role !== 'admin' && String(req.userId).toLowerCase() !== String(id).toLowerCase()) {
            return res.status(403).json({ error: 'Acesso negado.' });
        }

        const [rows] = await connect.promise().query(
            `SELECT BIN_TO_UUID(id) AS id, role, name, email, cellphone, birthday, status, created_in AS createdIn
             FROM \`user\` WHERE id = ?`,
            [uuid.toBin(id)]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }

        return res.status(200).json(rows[0]);
    } catch (error) {
        console.error('Erro em getUserById:', error);
        return res.status(500).json({ error: 'Erro ao buscar usuário.' });
    }
};

const patchPassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Senha atual e nova senha são obrigatórias.' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'A nova senha deve ter no mínimo 6 caracteres.' });
        }

        if (currentPassword === newPassword) {
            return res.status(400).json({ error: 'A nova senha deve ser diferente da atual.' });
        }

        const [rows] = await connect.promise().query(
            `SELECT password FROM \`user\` WHERE id = ?`,
            [uuid.toBin(req.userId)]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }

        const validCurrent = await bcrypt.compare(currentPassword, rows[0].password);

        if (!validCurrent) {
            return res.status(401).json({ error: 'Senha atual incorreta.' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await connect.promise().query(
            `UPDATE \`user\` SET password = ? WHERE id = ?`,
            [hashedPassword, uuid.toBin(req.userId)]
        );

        return res.status(200).json({
            message: 'Senha atualizada com sucesso.'
        });
    } catch (error) {
        console.error('Erro em changePassword:', error);
        return res.status(500).json({ error: 'Erro ao atualizar senha.' });
    }
};

const forgotPassword = async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ error: 'Email é obrigatório.' });
    }

    try {
        const [rows] = await connect.promise().query(
            `SELECT BIN_TO_UUID(id) AS id FROM \`user\` WHERE email = ?`,
            [email]
        );

        if (rows.length > 0) {
            const resetToken = jwt.sign(
                { id: rows[0].id, purpose: 'password_reset' },
                process.env.SECRET,
                { expiresIn: '30m' }
            );
            try {
                await enviarEmailReset(email, resetToken);
            } catch (emailError) {
                console.error('Falha ao enviar email de reset:', emailError.message);
            }
        }

        // Resposta sempre igual, exista ou não a conta (não vaza cadastro).
        return res.status(200).json({ message: 'Se o email estiver cadastrado, você receberá o link de redefinição.' });
    } catch (error) {
        console.error('Erro em forgotPassword:', error);
        return res.status(500).json({ error: 'Erro ao solicitar redefinição de senha.' });
    }
};

const resetPassword = async (req, res) => {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
        return res.status(400).json({ error: 'Token e nova senha são obrigatórios.' });
    }

    if (newPassword.length < 6) {
        return res.status(400).json({ error: 'A nova senha deve ter no mínimo 6 caracteres.' });
    }

    let decoded;
    try {
        decoded = jwt.verify(token, process.env.SECRET);
    } catch (error) {
        return res.status(401).json({ error: 'Link inválido ou expirado.' });
    }

    if (decoded.purpose !== 'password_reset' || !decoded.id || !uuid.isValid(decoded.id)) {
        return res.status(401).json({ error: 'Link inválido ou expirado.' });
    }

    try {
        const [rows] = await connect.promise().query(
            `SELECT id FROM \`user\` WHERE id = ?`,
            [uuid.toBin(decoded.id)]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await connect.promise().query(
            `UPDATE \`user\` SET password = ? WHERE id = ?`,
            [hashedPassword, uuid.toBin(decoded.id)]
        );

        return res.status(200).json({
            message: 'Senha redefinida com sucesso.'
        });
    } catch (error) {
        console.error('Erro em resetPassword:', error);
        return res.status(500).json({ error: 'Erro ao redefinir senha.' });
    }
};

const firstAccessPassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Senha temporária e nova senha são obrigatórias.' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'A nova senha deve ter no mínimo 6 caracteres.' });
        }

        if (currentPassword === newPassword) {
            return res.status(400).json({ error: 'A nova senha deve ser diferente da temporária.' });
        }

        const [rows] = await connect.promise().query(
            `SELECT password, status FROM \`user\` WHERE id = ?`,
            [uuid.toBin(req.userId)]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }

        if (rows[0].status !== 'firstLogin') {
            return res.status(400).json({ error: 'Senha já definida. Use a troca de senha normal.' });
        }

        const validTemp = await bcrypt.compare(currentPassword, rows[0].password);

        if (!validTemp) {
            return res.status(401).json({ error: 'Senha temporária incorreta.' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await connect.promise().query(
            `UPDATE \`user\` SET password = ?, status = 'active' WHERE id = ?`,
            [hashedPassword, uuid.toBin(req.userId)]
        );

        return res.status(200).json({
            message: 'Nova senha definida com sucesso. Bem-vindo!'
        });
    } catch (error) {
        console.error('Erro em firstAccessPassword:', error);
        return res.status(500).json({ error: 'Erro ao definir nova senha.' });
    }
};

module.exports = { createUser, createAdmin, createCompany, loginUser, loginGoogle, linkedinAuthUrl, linkedinCallback, getAllUsers, getUsersByName, updateUser, deleteUser, getUserById, getUserPhoto, patchPassword, forgotPassword, resetPassword, firstAccessPassword };
