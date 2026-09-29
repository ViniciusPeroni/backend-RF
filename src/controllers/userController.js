const otpService = require('../services/otpService');
const connect = require("../db/connect");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const uuid = require('../utils/uuid');
const doc = require('../services/docService');
const loc = require('../services/localizationService');
const generatePassword = require('../utils/generateRandomPassword');
const enviarCredenciaisAdmin = require('../utils/sendAdminCredentials');
const enviarEmailReset = require('../utils/sendPasswordReset');

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
        const validPassword = await bcrypt.compare(password, user.password);

        if (!validPassword) {
            return res.status(401).json({ error: 'Email ou senha incorretos.' });
        }

        if (user.status !== 'active' && user.status !== 'firstLogin') {
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
            user,
            mustChangePassword: user.status === 'firstLogin'
        });
    } catch (error) {
        return res.status(500).json({ error: 'Erro ao realizar login.' });
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

module.exports = { createUser, createAdmin, createCompany, loginUser, getAllUsers, getUsersByName, updateUser, deleteUser, getUserById, patchPassword, forgotPassword, resetPassword, firstAccessPassword };