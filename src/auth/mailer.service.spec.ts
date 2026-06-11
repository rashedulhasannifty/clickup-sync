import { MailerService } from './mailer.service';

describe('MailerService', () => {
  it('builds an invite email with the tokenized link and sends via transport', async () => {
    const sent: any[] = [];
    const config = { get: (k: string, d?: any) => ({ APP_BASE_URL: 'https://app.test', MAIL_FROM: 'from@test', SMTP_HOST: '' }[k] ?? d) } as any;
    const svc = new MailerService(config);
    (svc as any).transport = { sendMail: async (m: any) => { sent.push(m); return { messageId: '1' }; } };

    await svc.sendInvite('invitee@test.com', 'tok123', 'Acme', 'ADMIN');

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('invitee@test.com');
    expect(sent[0].html).toContain('https://app.test/invite/tok123');
    expect(sent[0].html).toContain('Acme');
  });
});
