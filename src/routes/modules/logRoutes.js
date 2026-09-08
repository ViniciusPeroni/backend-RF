const router = require("express").Router();
const logController = require("../../controllers/logController");

router.post("/", logController.createLog);
router.get("/", logController.listLogs);
router.get("/:id", logController.getLogById);
router.put("/:id", logController.updateLog);
router.delete("/:id", logController.deleteLog);

module.exports = router;
