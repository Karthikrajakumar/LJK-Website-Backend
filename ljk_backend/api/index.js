const express = require("express");
const cors = require("cors");
const axios = require("axios");
const multer = require("multer");
require("dotenv").config();
const serverless = require("serverless-http");

// Controllers
const grievanceController = require("../controller/grievance");
const membershipController = require("../controller/membership");
const membershipRoutes = require("../controller/MembershipRoute");

const app = express();
const PORT = process.env.PORT || 5000;
const isProduction = process.env.NODE_ENV === "production";
app.use(express.json());


const membershipPhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/webp",
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only image files (JPG, PNG, WebP) are allowed!"));
    }
  },
});

const allowedOrigins = [
  "https://ljk-website.vercel.app", // production frontend
  "http://localhost:3000", // local frontend
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);

// Handle preflight
app.options(/.*/, cors());

app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

// Dev logging
if (!isProduction) {
  app.use((req, res, next) => {
    console.log(
      `${new Date().toISOString()} - ${req.method} ${req.originalUrl}`
    );
    next();
  });
}

console.log("API routes are being set up...");

app.get("/", (req, res) => {
  res.json({ message: "Backend running on Vercel 🚀" });
});

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    message: "Server is running",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api", (req, res) => {
  res.status(200).json({
    name: "LJK Portal API",
    version: "1.0.0",
    endpoints: {
      grievances: {
        submit: "POST /api/grievances/submit",
        track: "GET /api/grievances/track/:trackingId",
        list: "GET /api/grievances/list",
        statistics: "GET /api/grievances/statistics",
        update: "PUT /api/grievances/update/:trackingId",
        delete: "DELETE /api/grievances/:trackingId",
      },
      membership: {
        register:
          "POST /api/membership/register (multipart/form-data or JSON)",
      },
      auth: {
        verifyOtp: "POST /api/verify-otp",
      },
    },
  });
});

console.log("Setting up grievance routes...");

app.post(
  "/api/grievances/submit",
  grievanceController.upload.array("files", 5),
  grievanceController.submitGrievance
);

app.get(
  "/api/grievances/track/:trackingId",
  grievanceController.trackGrievance
);

app.get("/api/grievances/list", grievanceController.listGrievances);
app.get("/api/grievances/statistics", grievanceController.getStatistics);

app.put(
  "/api/grievances/update/:trackingId",
  grievanceController.updateGrievanceStatus
);

app.delete(
  "/api/grievances/:trackingId",
  grievanceController.deleteGrievance
);

app.use("/api/membership", membershipRoutes);

app.post(
  "/api/membership/register",
  membershipPhotoUpload.single("photo"),
  membershipController.registerMember
);

app.post("/api/verify-otp", async (req, res) => {
  const { token, type } = req.body;

  if (!token || !type) {
    return res.status(400).json({
      success: false,
      message: "token and type are required",
    });
  }

  if (!["grievance", "membership"].includes(type)) {
    return res.status(400).json({
      success: false,
      message: "Invalid type. Use 'grievance' or 'membership'",
    });
  }

  try {
    const authKey =
      type === "grievance"
        ? process.env.MSG91_AUTH_KEY_GRIEVANCE
        : process.env.MSG91_AUTH_KEY_MEMBERSHIP;

    if (!authKey) {
      return res.status(500).json({
        success: false,
        message: "Auth key not configured for this type",
      });
    }

    const { data } = await axios.post(
      "https://control.msg91.com/api/v5/widget/verifyAccessToken",
      { token },
      {
        headers: {
          authkey: authKey,
          "Content-Type": "application/json",
        },
      }
    );

    return res.status(200).json({
      success: true,
      message: "OTP verified successfully",
      verifiedFor: type,
      mobile: data?.mobile,
    });
  } catch (err) {
    console.error(
      "OTP Verification Error:",
      err.response?.data || err.message
    );

    return res.status(401).json({
      success: false,
      message:
        err.response?.data?.message || "OTP verification failed",
    });
  }
});

console.log("All routes set up. Server is ready to handle requests.");

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
    path: req.path,
  });
});

app.use((err, req, res, next) => {
  console.error("Server Error:", err);

  // Multer file size error
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({
      success: false,
      message:
        "Photo size is too large. Maximum size is 10MB.",
      error: "FileTooLarge",
    });
  }

  // Custom file type error
  if (err.message?.includes("Only image files")) {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }

  // JSON payload too large
  if (err.type === "entity.too.large") {
    return res.status(413).json({
      success: false,
      message:
        "Request payload is too large. Reduce photo size or use multipart upload.",
      error: "PayloadTooLarge",
    });
  }

  return res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal server error",
  });
});

module.exports = serverless(app);
