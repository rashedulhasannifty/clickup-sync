import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

export interface SpikeNoticeArgs {
  to: string;
  userName: string;
  date: string;
  totalHours: number;
  reason: string;
  note: string | null;
  tasks: { taskId: string; taskName: string; hours: number }[];
}

@Injectable()
export class MailerService implements OnModuleInit {
  private readonly logger = new Logger(MailerService.name);
  private transport!: nodemailer.Transporter;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const host = this.config.get<string>('SMTP_HOST', '');
    if (host) {
      this.transport = nodemailer.createTransport({
        host,
        port: this.config.get<number>('SMTP_PORT', 587),
        secure: this.config.get<number>('SMTP_PORT', 587) === 465,
        auth: this.config.get<string>('SMTP_USER', '')
          ? { user: this.config.get<string>('SMTP_USER', ''), pass: this.config.get<string>('SMTP_PASS', '') }
          : undefined,
      });
    } else {
      this.transport = nodemailer.createTransport({ jsonTransport: true });
      this.logger.warn('SMTP_HOST not set — emails are logged, not sent (dev mode).');
    }
  }

  async sendInvite(to: string, token: string, orgName: string, role: string): Promise<void> {
    const base = this.config.get<string>('APP_BASE_URL', 'http://localhost:5173');
    const link = `${base}/invite/${token}`;
    const from = this.config.get<string>('MAIL_FROM', 'no-reply@example.com');
    const html = `<p>You've been invited to join <strong>${orgName}</strong> as <strong>${role}</strong> on ClickUp Sync.</p>
<p><a href="${link}">Accept your invitation</a></p>
<p>Or paste this link: ${link}</p>
<p>This invite expires in 7 days.</p>`;
    const info = await this.transport.sendMail({ from, to, subject: `Invitation to ${orgName}`, html });
    if (!this.config.get<string>('SMTP_HOST', '')) {
      this.logger.log(`[DEV EMAIL] invite for ${to}: ${link}`);
    } else {
      this.logger.log(`Invite email sent to ${to} (messageId=${(info as any).messageId})`);
    }
  }

  async sendSpikeNotice(args: SpikeNoticeArgs): Promise<void> {
    const from = this.config.get<string>('MAIL_FROM', 'no-reply@example.com');
    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const rows = args.tasks
      .map(
        (t) =>
          `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee;">${esc(t.taskName)}</td>` +
          `<td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right;">${t.hours.toFixed(2)}h</td></tr>`,
      )
      .join('');
    const noteBlock = args.note
      ? `<p style="margin:12px 0;padding:10px 12px;background:#fff7ed;border-left:3px solid #f59e0b;">${esc(args.note)}</p>`
      : '';
    const html = `<p>Hi ${esc(args.userName)},</p>
<p>Our time-tracking review flagged <strong>${esc(args.date)}</strong> (Asia/Dhaka): you logged <strong>${args.totalHours.toFixed(2)}h</strong>, which is ${esc(args.reason)}.</p>
${noteBlock}
<table style="border-collapse:collapse;font-size:14px;margin:8px 0;">
<thead><tr><th style="text-align:left;padding:4px 8px;border-bottom:2px solid #ccc;">Task</th><th style="text-align:right;padding:4px 8px;border-bottom:2px solid #ccc;">Hours</th></tr></thead>
<tbody>${rows}</tbody>
</table>
<p>Please review these entries in ClickUp and correct any mistakes.</p>`;
    const subject = `Heads up: unusually high hours logged on ${args.date}`;
    const info = await this.transport.sendMail({ from, to: args.to, subject, html });
    if (!this.config.get<string>('SMTP_HOST', '')) {
      this.logger.log(`[DEV EMAIL] spike notice for ${args.to} on ${args.date} (${args.totalHours.toFixed(2)}h)`);
    } else {
      this.logger.log(`Spike notice sent to ${args.to} (messageId=${(info as { messageId?: string }).messageId})`);
    }
  }
}
