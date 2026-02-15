const express = require("express");
const { registerMember, listMember } = require("./membership.js");

const router = express.Router();

// POST /api/membership/register
router.post("/register", registerMember);
router.get("/list", listMember);

module.exports = router;
