import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as nodemailer from "nodemailer";

/** Escape a value before it goes into an HTML email body. Every interpolated
 *  string in an email must go through this — `orgName` is operator-set and task
 *  names come from ClickUp, so neither is trusted markup. */
const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export interface SpikeNoticeArgs {
  to: string;
  userName: string;
  date: string;
  totalHours: number;
  reason: string;
  note: string | null;
  tasks: { taskId: string; taskName: string; hours: number }[];
}

const SANS = "Helvetica,Arial,'Segoe UI',sans-serif";

@Injectable()
export class MailerService implements OnModuleInit {
  private readonly logger = new Logger(MailerService.name);
  private transport!: nodemailer.Transporter;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const host = this.config.get<string>("SMTP_HOST", "");
    if (host) {
      this.transport = nodemailer.createTransport({
        host,
        port: this.config.get<number>("SMTP_PORT", 587),
        secure: this.config.get<number>("SMTP_PORT", 587) === 465,
        auth: this.config.get<string>("SMTP_USER", "")
          ? {
              user: this.config.get<string>("SMTP_USER", ""),
              pass: this.config.get<string>("SMTP_PASS", ""),
            }
          : undefined,
      });
    } else {
      this.transport = nodemailer.createTransport({ jsonTransport: true });
      this.logger.warn(
        "SMTP_HOST not set — emails are logged, not sent (dev mode).",
      );
    }
  }

  private baseUrl(): string {
    return this.config.get<string>("APP_BASE_URL", "http://localhost:5173");
  }

  /** Wrap a body fragment in the Nifty Log email shell.
   *
   *  Table layout and inline styles only — Outlook renders through Word, which
   *  ignores <style> blocks, flexbox and most of CSS. The mark is a PNG, not the
   *  SVG favicon: Gmail and Outlook both strip inline SVG and neither renders an
   *  <img> pointing at one. It is served by the frontend at APP_BASE_URL, so a
   *  deploy that moves the SPA moves the logo with it. The wordmark beside it is
   *  live text on purpose — most clients block remote images by default, and the
   *  brand still has to read when the image is a grey box. */
  private shell(heading: string, bodyHtml: string): string {
    const logo = `${this.baseUrl()}/brand/nifty-log-mark.png`;
    return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f5f5f4;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f4;padding:28px 12px;">
<tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="520" style="width:520px;max-width:100%;background:#ffffff;border:1px solid #e7e5e2;border-radius:14px;">
<tr><td style="padding:26px 30px 0;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle" style="padding-right:11px;"><img src="${logo}" width="40" height="40" alt="Nifty Log" style="display:block;width:40px;height:40px;border:0;" /></td>
<td valign="middle" style="font-family:${SANS};font-size:21px;font-weight:700;letter-spacing:-0.4px;color:#0f172a;line-height:1;">Nifty <span style="color:#7B68EE;">Log</span></td>
</tr></table>
</td></tr>
<tr><td style="padding:22px 30px 0;font-family:${SANS};font-size:18px;font-weight:700;color:#0f172a;">${heading}</td></tr>
<tr><td style="padding:10px 30px 28px;font-family:${SANS};font-size:14px;line-height:1.6;color:#334155;">${bodyHtml}</td></tr>
</table>
<div style="width:520px;max-width:100%;margin:14px auto 0;font-family:${SANS};font-size:11.5px;color:#94a3b8;text-align:center;">Nifty Log &middot; task &amp; time reporting</div>
</td></tr>
</table>
</body></html>`;
  }

  /** A "bulletproof" button: a table cell with a background, because Outlook
   *  drops padding and background on a bare <a>. */
  private button(href: string, label: string): string {
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 6px;"><tr>
<td style="background:#7B68EE;border-radius:9px;"><a href="${href}" style="display:inline-block;padding:12px 22px;font-family:${SANS};font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;">${label}</a></td>
</tr></table>`;
  }

  private fallback(link: string): string {
    return `<p style="margin:14px 0 0;font-size:12.5px;color:#64748b;">Or paste this link into your browser:<br /><a href="${link}" style="color:#5b48c9;word-break:break-all;">${link}</a></p>`;
  }

  async sendInvite(
    to: string,
    token: string,
    orgName: string,
    role: string,
  ): Promise<void> {
    const link = `${this.baseUrl()}/invite/${token}`;
    const from = this.config.get<string>("MAIL_FROM", "no-reply@example.com");
    const html = this.shell(
      `You've been invited to ${esc(orgName)}`,
      `<p style="margin:0;">You've been invited to join <strong>${esc(orgName)}</strong> as <strong>${esc(role)}</strong> on Nifty Log.</p>
${this.button(link, "Accept your invitation")}
${this.fallback(link)}
<p style="margin:14px 0 0;font-size:12.5px;color:#64748b;">This invite expires in 7 days.</p>`,
    );
    const info = await this.transport.sendMail({
      from,
      to,
      subject: `Invitation to ${orgName}`,
      html,
    });
    if (!this.config.get<string>("SMTP_HOST", "")) {
      this.logger.log(`[DEV EMAIL] invite for ${to}: ${link}`);
    } else {
      this.logger.log(
        `Invite email sent to ${to} (messageId=${(info as { messageId?: string }).messageId})`,
      );
    }
  }

  async sendPasswordReset(to: string, token: string): Promise<void> {
    const link = `${this.baseUrl()}/reset/${token}`;
    const from = this.config.get<string>("MAIL_FROM", "no-reply@example.com");
    const html = this.shell(
      "Reset your password",
      `<p style="margin:0;">We received a request to reset your Nifty Log password.</p>
${this.button(link, "Choose a new password")}
${this.fallback(link)}
<p style="margin:14px 0 0;font-size:12.5px;color:#64748b;">This link expires in 1 hour and can only be used once. If you didn't ask for it, you can ignore this email — your password won't change.</p>`,
    );
    const info = await this.transport.sendMail({
      from,
      to,
      subject: "Reset your Nifty Log password",
      html,
    });
    if (!this.config.get<string>("SMTP_HOST", "")) {
      this.logger.log(`[DEV EMAIL] password reset for ${to}: ${link}`);
    } else {
      this.logger.log(
        `Password reset email sent to ${to} (messageId=${(info as { messageId?: string }).messageId})`,
      );
    }
  }

  async sendSpikeNotice(args: SpikeNoticeArgs): Promise<void> {
    const from = this.config.get<string>("MAIL_FROM", "no-reply@example.com");
    const rows = args.tasks
      .map(
        (t) =>
          `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee;">${esc(t.taskName)}</td>` +
          `<td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right;">${t.hours.toFixed(2)}h</td></tr>`,
      )
      .join("");
    const noteBlock = args.note
      ? `<p style="margin:12px 0;padding:10px 12px;background:#fff7ed;border-left:3px solid #f59e0b;">${esc(args.note)}</p>`
      : "";
    const html = this.shell(
      `Unusually high hours on ${esc(args.date)}`,
      `<p style="margin:0;">Hi ${esc(args.userName)},</p>
<p>Our time-tracking review flagged <strong>${esc(args.date)}</strong> (Asia/Dhaka): you logged <strong>${args.totalHours.toFixed(2)}h</strong>, which is ${esc(args.reason)}.</p>
${noteBlock}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-size:14px;margin:8px 0;">
<thead><tr><th style="text-align:left;padding:4px 8px;border-bottom:2px solid #ccc;">Task</th><th style="text-align:right;padding:4px 8px;border-bottom:2px solid #ccc;">Hours</th></tr></thead>
<tbody>${rows}</tbody>
</table>
<p style="margin:14px 0 0;">Please review these entries in ClickUp and correct any mistakes.</p>`,
    );
    const subject = `Heads up: unusually high hours logged on ${args.date}`;
    const info = await this.transport.sendMail({
      from,
      to: args.to,
      subject,
      html,
    });
    if (!this.config.get<string>("SMTP_HOST", "")) {
      this.logger.log(
        `[DEV EMAIL] spike notice for ${args.to} on ${args.date} (${args.totalHours.toFixed(2)}h)`,
      );
    } else {
      this.logger.log(
        `Spike notice sent to ${args.to} (messageId=${(info as { messageId?: string }).messageId})`,
      );
    }
  }
}
