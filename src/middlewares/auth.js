    function roleMiddleware(permittedRoles) {
    return (req, res, next) => {
        if (!req.role) return res.status(401).json({ error: 'Autenticação necessária.' });
        if (!permittedRoles.includes(req.role)) {
            return res.status(403).json({ error: 'Acesso negado.' });
        }
        next();
    };
}

module.exports = roleMiddleware;