const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
require("dotenv").config();
const express = require("express");
const app = express();
const cors = require("cors");
const connectDB = require("./config/db");

app.use(cors());
app.use(express.json());
const mongoose = require("mongoose");
const authRoutes = require("./routes/authRoutes");
const contractRoutes = require("./routes/contractRoutes");

app.get("/", (req, res) => {
  res.json({
    status: "Legal Contract Agent API Gateway is running",
    version: "1.0.0",
    endpoints: {
      auth: "/api/auth",
      contracts: "/api/contracts",
      health: "/health",
    },
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    gateway: "Legal Contract Agent - Express API Gateway",
    version: "1.0.0",
    database: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/contracts", contractRoutes);

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await connectDB();

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error.message);
  }
};

startServer();