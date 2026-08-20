import nodemailer from 'nodemailer';

let transporter;

function appUrl() {
  return String(process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');
}

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST) return null;

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' }
      : undefined,
  });
  return transporter;
}

async function deliver({ to, subject, text, html }) {
  const mailer = getTransporter();
  if (!mailer) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SMTP is not configured for the production VPS server.');
    }
    console.info(`[development email] ${subject} -> ${to}\n${text}`);
    return { delivered: false };
  }

  await mailer.sendMail({
    from: process.env.MAIL_FROM || 'Site Manager <no-reply@localhost>',
    to,
    subject,
    text,
    html,
  });
  return { delivered: true };
}

export async function sendVerificationEmail(email, token) {
  const url = `${appUrl()}/?verify_token=${encodeURIComponent(token)}`;
  const result = await deliver({
    to: email,
    subject: 'Verify your Site Manager account',
    text: `Verify your Site Manager account: ${url}`,
    html: `<p>Welcome to Site Manager.</p><p><a href="${url}">Verify your email address</a></p><p>This link expires in 24 hours.</p>`,
  });
  return { ...result, development_url: url };
}

export async function sendPasswordResetEmail(email, token) {
  const url = `${appUrl()}/?reset_token=${encodeURIComponent(token)}`;
  const result = await deliver({
    to: email,
    subject: 'Reset your Site Manager password',
    text: `Reset your Site Manager password: ${url}`,
    html: `<p>A password reset was requested for your Site Manager account.</p><p><a href="${url}">Reset your password</a></p><p>This link expires in 60 minutes. If you did not request it, ignore this email.</p>`,
  });
  return { ...result, development_url: url };
}
