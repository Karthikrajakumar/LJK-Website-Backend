const express = require("express");
const router = express.Router();
const agentController = require("./agent");

router.get("/", agentController.listAgents);
router.post("/", agentController.createAgent);
router.patch("/:agentId", agentController.updateAgent);
router.delete("/:agentId", agentController.deleteAgent);

module.exports = router;
