const router = require("express").Router();
const notificationController = require("../../controllers/notificationController");
const verifyJWT = require("../../middlewares/verifyJWT");
const preferencesController = require("../../controllers/notificationPreferencesController");

router.use(verifyJWT);

router.get("/preferences", preferencesController.getPreferences);
router.put("/preferences", preferencesController.putPreferences);
router.put("/devices/:id", preferencesController.putDevice);
router.delete("/devices/:id", preferencesController.deleteDevice);

router.post("/", notificationController.createNotification);
router.get("/", notificationController.listNotifications);
router.get("/unread/count", notificationController.countUnread);
router.patch("/read-all", notificationController.markAllAsRead);
router.get("/:id", notificationController.getNotificationById);
router.patch("/:id/read", notificationController.markAsRead);
router.delete("/:id", notificationController.deleteNotification);

module.exports = router;
