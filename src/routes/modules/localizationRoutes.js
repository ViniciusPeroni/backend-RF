const router = require("express").Router();
const localizationController = require("../../controllers/localizationController");
const validateLocalization = require("../../middlewares/validateLocalization");

router.post("/", validateLocalization, localizationController.createLocalization);

module.exports = router;
