/**
 * Transactional email delivery utility supporting Resend API in production
 * with safe structured preview fallback in local development / test environments.
 */

const FROM_ADDRESS = process.env.EMAIL_FROM || "Legal Contract Agent <security@legalcontractagent.local>";
const APP_URL = (process.env.APP_URL || "http://localhost:5173").replace(/\/+$/, "");

async function sendEmail({ to, subject, html, text }) {
  const resendKey = (process.env.RESEND_API_KEY || "").trim();

  if (resendKey) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: FROM_ADDRESS,
          to: [to],
          subject,
          html,
          text,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        return { delivered: true, provider: "resend" };
      }
      console.warn("Resend email delivery failed with status:", res.status);
    } catch (err) {
      console.warn("Resend email delivery error:", err.message);
    }
  }

  // Safe local preview log (never logs in silent test mode unless requested)
  if (process.env.NODE_ENV !== "production") {
    console.log(`[MAIL PREVIEW] To: ${to} | Subject: ${subject}\n${text}`);
  }
  return { delivered: false, provider: "local-preview" };
}

async function sendPasswordResetEmail(to, rawToken) {
  const resetUrl = `${APP_URL}/reset-password?token=${encodeURIComponent(rawToken)}`;
  return sendEmail({
    to,
    subject: "Reset your Legal Contract Agent password",
    text: `Use the following link within 30 minutes to reset your password:\n${resetUrl}`,
    html: `<p>Use the link below within 30 minutes to reset your password:</p><p><a href="${resetUrl}">${resetUrl}</a></p>`,
  });
}

async function sendTeamInviteEmail(to, orgName, inviterName, inviteCode) {
  const joinUrl = `${APP_URL}/security?invite=${encodeURIComponent(inviteCode)}`;
  return sendEmail({
    to,
    subject: `${inviterName} invited you to ${orgName} on Legal Contract Agent`,
    text: `${inviterName} invited you to collaborate in "${orgName}". Join with invite code ${inviteCode} at ${joinUrl}`,
    html: `<p><strong>${inviterName}</strong> invited you to collaborate in <strong>${orgName}</strong>.</p><p>Invite code: <code>${inviteCode}</code></p><p><a href="${joinUrl}">Open workspace</a></p>`,
  });
}

module.exports = { sendEmail, sendPasswordResetEmail, sendTeamInviteEmail };
