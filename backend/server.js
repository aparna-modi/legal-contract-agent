require("dotenv").config();
const express = require("express");
const app = express();
const cors = require("cors");
const connectDB = require("./config/db");

app.use(cors());
app.use(express.json());
const authRoutes = require("./routes/authRoutes");
const contractRoutes = require("./routes/contractRoutes");

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