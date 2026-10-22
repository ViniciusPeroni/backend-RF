const router = require("express").Router();

router.use("/user", require("./modules/userRoutes"));
router.use("/localization", require("./modules/localizationRoutes"));
router.use("/document", require("./modules/documentRoutes"));
router.use("/otp", require("./modules/otpRoutes"));
router.use("/product", require("./modules/productRoutes"));
router.use("/shopping", require("./modules/shoppingRoutes"));
router.use("/shopping-product", require("./modules/shoppingProductRoutes"));
router.use("/commission", require("./modules/commissionRoutes"));
router.use("/log", require("./modules/logRoutes")); 

module.exports = router;
