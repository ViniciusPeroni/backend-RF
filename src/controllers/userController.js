const otpService = require('../services/otpService');
const connect = require("../db/connect");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const uuid = require('../utils/uuid');
const doc = require('../services/docService');
const loc = require('../services/localizationService');

const VALID_ROLES = ['user', 'company', 'admin'];
const VALID_STATUS = ['inactive', 'awaitingForEmail', 'active'];

function isValidEmail(email) {
    return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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

    if (!cpf || !name || !email || !cnpj || !password || !cellphone || !zip_code || !street || !neighborhood || !number || !city || !state) {
        return res.status(400).json({ error: 'Todos os campos são obrigatórios.' });
    }

    const role = req.body.role || 'company';

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

    return res.status(201).json({
        message: emailSent
            ? 'Empresa criada com sucesso. Confirme o email para ativar a conta.'
            : 'Empresa criada, mas o e-mail de confirmação falhou. Solicite um novo código.',
        id,
        emailSent
    });
};

const createAdmin = async (req, res) => {
    const { cpf, name, email, password, cellphone, birthday, zip_code, street, neighborhood, number, city, state } = req.body;
    const photo = req.file ? req.file.buffer : null;

    if (!cpf || !name || !email || !password || !cellphone || !birthday || !zip_code || !street || !neighborhood || !number || !city || !state) {
        return res.status(400).json({ error: 'Todos os campos são obrigatórios.' });
    }

    const role = 'admin';

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

    return res.status(201).json({
        message: emailSent
            ? 'Usuário criado com sucesso. Confirme o email para ativar a conta.'
            : 'Usuário criado, mas o e-mail de confirmação falhou. Solicite um novo código.',
        id,
        emailSent
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
        const validPassword = await bcrypt.compare(password, user.password);

        if (!validPassword) {
            return res.status(401).json({ error: 'Email ou senha incorretos.' });
        }

        if (user.status !== 'active') {
            return res.status(403).json({ error: 'Conta ainda não ativada. Confirme seu email.' });
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
            user
        });
    } catch (error) {
        return res.status(500).json({ error: 'Erro ao realizar login.' });
    }
};

module.exports = { createUser, createAdmin, createCompany, loginUser };