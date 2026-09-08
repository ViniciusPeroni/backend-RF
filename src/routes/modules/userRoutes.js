const router = require("express").Router();
const userController = require("../../controllers/userController");
const upload = require("../../middlewares/upload");
const roleMiddleware = require("../../middlewares/auth");
const verifyJWT = require("../../middlewares/verifyJWT");
const {authLimiter, globalLimiter} = require("../../middlewares/rateLimit");


function forceUserRole(req, res, next) {
    delete req.body.role;
    next();
}


router.use(globalLimiter);
router.post("/create", upload.single("photo"), forceUserRole, userController.createUser);
router.post("/create/empresa", upload.single("photo"), forceUserRole, userController.createCompany);
router.post("/login", authLimiter, userController.loginUser);



// ======================================================
// --------     Rotas cm JWT
// ======================================================
router.use(verifyJWT);







// ======================================================
// --------     Rotas de ADM
// ======================================================
router.use(roleMiddleware(['admin']))


router.post("/create/admin", userController.createAdmin);

module.exports = router;