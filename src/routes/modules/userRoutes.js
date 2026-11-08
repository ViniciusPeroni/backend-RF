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
router.post("/login/google", authLimiter, userController.loginGoogle);
router.get("/login/linkedin", authLimiter, userController.linkedinAuthUrl);
router.get("/login/linkedin/callback", authLimiter, userController.linkedinCallback);
router.post("/login/linkedin/callback", authLimiter, userController.linkedinCallback);
router.post("/password/forgot", authLimiter, userController.forgotPassword);
router.post("/password/reset", userController.resetPassword);



// ======================================================
// --------     Rotas cm JWT
// ======================================================
router.use(verifyJWT);







// --------     Rotas de usuário autenticado (dono da conta ou JWT válido)
// ======================================================
router.put("/:id", upload.single("photo"), userController.updateUser);
router.delete("/:id", userController.deleteUser);
router.get("/:id/photo", userController.getUserPhoto);
router.get("/:id", userController.getUserById);
router.patch("/password", userController.patchPassword);
router.patch("/password/first-access", userController.firstAccessPassword);

// ======================================================
// --------     Rotas de ADM
// ======================================================
router.use(roleMiddleware(['admin']))


router.post("/create/admin", userController.createAdmin);
router.get("/", userController.getAllUsers);
router.get("/search/:name", userController.getUsersByName);

module.exports = router;