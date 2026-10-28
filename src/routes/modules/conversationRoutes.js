const router = require("express").Router();
const conversationController = require("../../controllers/conversationController");
const verifyJWT = require("../../middlewares/verifyJWT");

router.use(verifyJWT);

router.post("/", conversationController.getOrCreateConversation);
router.get("/", conversationController.listConversations);
router.get("/:id", conversationController.getConversationById);
router.delete("/:id", conversationController.leaveConversation);

module.exports = router;
