
const router = require("express").Router();

const reviewController = require("../../controllers/reviewController");
const verifyJWT = require("../../middlewares/verifyJWT");

router.get("/", reviewController.getReviews);

router.get("/:id", reviewController.getReviewById);

router.post("/create", verifyJWT, reviewController.createReview);

router.put("/:id", verifyJWT, reviewController.updateReview);

router.delete("/:id", verifyJWT, reviewController.deleteReview);

module.exports = router;
