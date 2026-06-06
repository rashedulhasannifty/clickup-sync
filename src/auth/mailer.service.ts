import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

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
}
