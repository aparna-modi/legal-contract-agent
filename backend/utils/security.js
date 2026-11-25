const fs = require("fs");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function isValidEmail(email) {
  if (typeof email !== "string") return false;
  const trimmed = email.trim();
  return trimmed.length <= 254 && EMAIL_REGEX.test(trimmed);
}

function validatePasswordStrength(password) {
  if (typeof password !== "string") {
    return "Password is required.";
  }
  if (password.length < 8) {
    return "Password must be at least 8 characters long.";
  }
  if (password.length > 128) {
    return "Password cannot exceed 128 characters.";
  }
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
    return "Password must include at least one letter and one number.";
  }
  return null;
}

function sanitizeValue(value, depth = 0) {
  if (depth > 10 || value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, depth + 1));
  }
  if (typeof value === "object") {
    const clean = {};
    for (const [key, val] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key) || key.startsWith("$") || key.includes("\0")) {
        continue;
      }
      clean[key] = sanitizeValue(val, depth + 1);
    }
    return clean;
  }
  if (typeof value === "string") {
    return value.replace(/\0/g, "");
  }
  return value;
}

function validateFileMagicBytes(filePath, ext) {
  let fd;
  try {
    fd = fs.openSync(filePath, "r");
    const buffer = Buffer.alloc(1024);
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    if (bytesRead === 0) {
      return { valid: false, message: "Uploaded file is empty." };
    }
    const slice = buffer.subarray(0, bytesRead);

    if (ext === "pdf") {
      if (!slice.includes(Buffer.from("%PDF-"))) {
        return {
          valid: false,
          message: "File content does not match a valid PDF header (%PDF-).",
        };
      }
    } else if (ext === "docx") {
      const isZip =
        (slice[0] === 0x50 && slice[1] === 0x4b && slice[2] === 0x03 && slice[3] === 0x04) ||
        (slice[0] === 0x50 && slice[1] === 0x4b && slice[2] === 0x05 && slice[3] === 0x06);
      if (!isZip) {
        return {
          valid: false,
          message: "File content does not match a valid DOCX archive signature.",
        };
      }
    } else if (ext === "txt") {
      if (slice.includes(0x00)) {
        return {
          valid: false,
          message: "Plain text uploads cannot contain binary null bytes.",
        };
      }
    }
    return { valid: true };
  } catch {
    return { valid: false, message: "Unable to inspect uploaded file signature." };
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // Ignore close error
      }
    }
  }
}

function getClientIp(req) {
  return (
    req.headers?.["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
    req.ip ||
    req.socket?.remoteAddress ||
    ""
  ).slice(0, 64);
}

function parseDeviceLabel(userAgent = "") {
  const ua = String(userAgent || "");
  if (!ua) return "API Client";
  let browser = "Browser";
  if (/Edg\//i.test(ua)) browser = "Microsoft Edge";
  else if (/Chrome\//i.test(ua)) browser = "Chrome";
  else if (/Firefox\//i.test(ua)) browser = "Firefox";
  else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = "Safari";
  else if (/node|undici|curl|axios|python/i.test(ua)) browser = "CLI / API Client";

  let os = "";
  if (/Windows/i.test(ua)) os = "Windows";
  else if (/Mac OS X|Macintosh/i.test(ua)) os = "macOS";
  else if (/Linux/i.test(ua)) os = "Linux";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/iPhone|iPad/i.test(ua)) os = "iOS";

  return os ? `${browser} on ${os}` : browser;
}

module.exports = {
  isValidEmail,
  validatePasswordStrength,
  sanitizeValue,
  validateFileMagicBytes,
  getClientIp,
  parseDeviceLabel,
};
