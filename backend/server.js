const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const mongoose = require("mongoose");

const connectDB = require("./config/db");
const { authLimiter } = require("./middleware/rateLimiters");
const authRoutes = require("./routes/authRoutes");
const contractRoutes = require("./routes/contractRoutes");
const feedbackRoutes = require("./routes/feedbackRoutes");
const analyticsRoutes = require("./routes/analyticsRoutes");

const app = express();

app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/", (req, res) => {
  res.json({
    status: "Legal Contract Agent API is running",
    version: "1.3.0",
    endpoints: {
      auth: "/api/auth",
      contracts: "/api/contracts",
      feedback: "/api/feedback",
      analytics: "/api/analytics",
      health: "/health",
    },
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    service: "Legal Contract Agent API",
    version: "1.3.0",
    database: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
  });
});

app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/contracts", contractRoutes);
app.use("/api/feedback", feedbackRoutes);
app.use("/api/analytics", analyticsRoutes);

// Return structured JSON for malformed request bodies or unexpected middleware failures.
app.use((err, req, res, next) => {
  if (err && err.type === "entity.parse.failed") {
    return res.status(400).json({ message: "Invalid JSON payload." });
  }
  console.error("Unhandled API error:", err?.message || err);
  res.status(err?.status || 500).json({
    message: err?.message || "Internal server error",
  });
});

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await connectDB();
    app.listen(PORT, () => {
      console.log(`API server listening on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
};

startServer();
