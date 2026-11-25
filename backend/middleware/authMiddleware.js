const User = require("../models/User");
const { verifyAccessToken } = require("../utils/tokens");

const protect = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      code: "TOKEN_MISSING",
      message: "Authentication required. Please sign in.",
    });
  }

  try {
    const token = authHeader.slice(7).trim();
    const decoded = verifyAccessToken(token);

    const user = await User.findById(decoded.userId).select("-password");
    if (!user) {
      return res.status(401).json({
        code: "USER_NOT_FOUND",
        message: "Account no longer exists or session is invalid.",
      });
    }

    // Instant token revocation check via monotonic tokenVersion.
    const expectedVersion = user.tokenVersion || 0;
    const tokenVersion = decoded.tv ?? 0;
    if (tokenVersion !== expectedVersion) {
      return res.status(401).json({
        code: "TOKEN_REVOKED",
        message: "Your session was revoked. Please sign in again.",
      });
    }

    req.user = user;
    req.auth = {
      userId: user._id.toString(),
      role: user.role || "reviewer",
      jti: decoded.jti || null,
      tokenVersion,
    };
    next();
  } catch (error) {
    const isExpired = error?.name === "TokenExpiredError";
    return res.status(401).json({
      code: isExpired ? "TOKEN_EXPIRED" : "TOKEN_INVALID",
      message: isExpired
        ? "Session access token expired. Refreshing session..."
        : "Not authorized, token invalid or malformed.",
    });
  }
};

const requireRole = (...allowedRoles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      code: "UNAUTHENTICATED",
      message: "Authentication required.",
    });
  }
  const userRole = req.user.role || "reviewer";
  if (!allowedRoles.includes(userRole)) {
    return res.status(403).json({
      code: "FORBIDDEN_ROLE",
      message: `Access restricted. Required role: ${allowedRoles.join(" or ")}.`,
    });
  }
  next();
};

module.exports = { protect, requireRole };
