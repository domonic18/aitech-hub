/**
 * 事务邮件(M21 批⓪,D1 邮箱通道):nodemailer SMTP;发送一律在 worker 进程
 * (QUEUE_EMAIL,请求内只 enqueue——请求内禁秒级任务,arch/00 §2)。
 * SMTP 配置读库(email_config 单行,admin 后台维护——用户拍板不入 env):
 * 未配置或 enabled=false 时发送显式跳过(dev 零依赖可起服务;生产录完配置
 * 并启用后即生效)。收件人日志一律 maskEmail 脱敏。
 */
import { createTransport, type Transporter } from "nodemailer";

import { getSmtpConfigRow } from "@/lib/email/smtp-config";

export interface MailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export type EmailJobData = MailInput;

/** transport 缓存:键含 updatedAt,admin 保存后自动换新,无显式失效机制 */
let cached: { key: string; fromAddr: string; transport: Transporter } | null = null;

async function getTransport(): Promise<{ transport: Transporter; fromAddr: string } | null> {
  const row = await getSmtpConfigRow();
  if (!row || !row.enabled) return null;
  const key = `${row.id}:${row.updatedAt.getTime()}`;
  if (!cached || cached.key !== key) {
    cached = {
      key,
      fromAddr: row.fromAddr,
      transport: createTransport({
        host: row.host,
        port: row.port,
        secure: row.port === 465,
        auth: { user: row.username, pass: row.password },
      }),
    };
  }
  return cached;
}

/** worker 侧实际发送;SMTP 未配置/未启用 → skipped(dev 兜底),调用方据此打日志 */
export async function sendMail(input: MailInput): Promise<{ skipped: boolean }> {
  const t = await getTransport();
  if (!t) return { skipped: true };
  await t.transport.sendMail({ from: t.fromAddr, ...input });
  return { skipped: false };
}

/**
 * admin「发送测试邮件」直发(POST /api/email-config/test 专用):不走缓存
 * transport 也不走 worker——交互式验收需要同步结果,属「请求内禁秒级任务」
 * 的受控例外(arch/00 §2):仅 admin、低频,且 8-10s 超时兜底防挂。
 * 未配置/未启用抛错(测试语义要显式失败,与 sendMail 的静默跳过不同)。
 */
export async function sendTestMail(to: string): Promise<void> {
  const row = await getSmtpConfigRow();
  if (!row || !row.enabled) throw new Error("SMTP 未配置或未启用,请先保存并启用");
  const transport = createTransport({
    host: row.host,
    port: row.port,
    secure: row.port === 465,
    auth: { user: row.username, pass: row.password },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 10000,
  });
  try {
    await transport.sendMail({
      from: row.fromAddr,
      to,
      subject: "【一起AI】SMTP 测试邮件",
      text: "这是一封测试邮件。收到即代表 SMTP 配置可用。",
      html: "<p>这是一封测试邮件,收到即代表 <b>SMTP 配置可用</b>。</p>",
    });
  } finally {
    transport.close();
  }
}

/** 密码重置邮件正文(2026-10-09 验收反馈问题1;链接指向 /reset-password 表单页) */
export function passwordResetContent(
  resetUrl: string,
  username: string,
): Pick<MailInput, "subject" | "text" | "html"> {
  const subject = "【一起AI】密码重置";
  const text =
    `${username} 你好!\n\n` +
    `请点击以下链接设置新密码(30 分钟内有效):\n${resetUrl}\n\n` +
    `如非本人操作,请忽略本邮件,账号密码不受影响。`;
  const html =
    `<p>${escapeHtml(username)} 你好!</p>` +
    `<p>请点击以下链接设置新密码(30 分钟内有效):</p>` +
    `<p><a href="${resetUrl}">重置密码</a></p>` +
    `<p style="color:#888">如按钮无效,复制链接到浏览器打开:<br>${resetUrl}</p>` +
    `<p style="color:#888">如非本人操作,请忽略本邮件,账号密码不受影响。</p>`;
  return { subject, text, html };
}

/** 注册验证邮件正文(纯文本 + 简单 HTML;链接指向 GET /api/auth/verify-email) */
export function verifyEmailContent(
  verifyUrl: string,
  username: string,
): Pick<MailInput, "subject" | "text" | "html"> {
  const subject = "【一起AI】注册邮箱验证";
  const text =
    `${username} 你好!\n\n` +
    `请点击以下链接完成注册验证(30 分钟内有效):\n${verifyUrl}\n\n` +
    `如非本人操作,请忽略本邮件。`;
  const html =
    `<p>${escapeHtml(username)} 你好!</p>` +
    `<p>请点击以下链接完成注册验证(30 分钟内有效):</p>` +
    `<p><a href="${verifyUrl}">完成邮箱验证</a></p>` +
    `<p style="color:#888">如按钮无效,复制链接到浏览器打开:<br>${verifyUrl}</p>` +
    `<p style="color:#888">如非本人操作,请忽略本邮件。</p>`;
  return { subject, text, html };
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}
