const express = require("express");
const {
  submitGrievance,
  trackGrievance,
  listGrievances,
  updateGrievanceStatus,
  deleteGrievance,
  getStatistics,
  upload,
} = require("./grievance");

const router = express.Router();

router.post("/submit", upload.array("files", 5), submitGrievance);
router.get("/track/:trackingId", trackGrievance);
// router.get("/list", listGrievances);
// router.get("/statistics", getStatistics);
// router.put("/update/:trackingId", updateGrievanceStatus);
// router.delete("/:trackingId", deleteGrievance);

module.exports = router;