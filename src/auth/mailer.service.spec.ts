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

  it('builds a spike-notice email with task rows, the note, and escapes HTML', async () => {
    const sent: any[] = [];
    const config = { get: (k: string, d?: any) => ({ MAIL_FROM: 'from@test', SMTP_HOST: '' }[k] ?? d) } as any;
    const svc = new MailerService(config);
    (svc as any).transport = { sendMail: async (m: any) => { sent.push(m); return { messageId: '2' }; } };

    await svc.sendSpikeNotice({
      to: 'member@test.com',
      userName: 'Rashedul',
      date: '2026-06-10',
      totalHours: 14.5,
      reason: 'over the 12h/day cap',
      note: 'Please review <these>',
      tasks: [{ taskId: '86a', taskName: 'Fix & ship', hours: 9 }],
    });

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('member@test.com');
    expect(sent[0].subject).toContain('2026-06-10');
    expect(sent[0].html).toContain('14.50h');
    expect(sent[0].html).toContain('over the 12h/day cap');
    expect(sent[0].html).toContain('Fix &amp; ship');          // task name escaped
    expect(sent[0].html).toContain('Please review &lt;these&gt;'); // note escaped
  });
  it('builds a password-reset email with the tokenized link', async () => {
    const sent: any[] = [];
    const config = { get: (k: string, d?: any) => ({ APP_BASE_URL: 'https://app.test', MAIL_FROM: 'from@test', SMTP_HOST: '' }[k] ?? d) } as any;
    const svc = new MailerService(config);
    (svc as any).transport = { sendMail: async (m: any) => { sent.push(m); return { messageId: '3' }; } };

    await svc.sendPasswordReset('member@test.com', 'tok456');

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('member@test.com');
    expect(sent[0].html).toContain('https://app.test/reset/tok456');
    expect(sent[0].html).toContain('1 hour');
  });

  // Every outbound email carries the brand. The mark is a PNG served off
  // APP_BASE_URL (clients strip inline SVG), and the wordmark is live text so
  // the brand still reads when the client blocks remote images — which is the
  // default in Gmail and Outlook. Both halves are asserted on purpose.
  it.each([
    ['invite', (s: MailerService) => s.sendInvite('invitee@test.com', 'tok123', 'Acme', 'ADMIN')],
    ['password reset', (s: MailerService) => s.sendPasswordReset('member@test.com', 'tok456')],
    [
      'spike notice',
      (s: MailerService) =>
        s.sendSpikeNotice({
          to: 'member@test.com',
          userName: 'Rashedul',
          date: '2026-06-10',
          totalHours: 14.5,
          reason: 'over the cap',
          note: null,
          tasks: [],
        }),
    ],
  ])('brands the %s email with the logo and wordmark', async (_name, send) => {
    const sent: any[] = [];
    const config = { get: (k: string, d?: any) => ({ APP_BASE_URL: 'https://app.test', MAIL_FROM: 'from@test', SMTP_HOST: '' }[k] ?? d) } as any;
    const svc = new MailerService(config);
    (svc as any).transport = { sendMail: async (m: any) => { sent.push(m); return { messageId: '4' }; } };

    await send(svc);

    const html: string = sent[0].html;
    expect(html).toContain('<img src="https://app.test/brand/nifty-log-mark.png"');
    expect(html).toContain('alt="Nifty Log"');
    expect(html).toContain('Nifty <span style="color:#7B68EE;">Log</span>'); // live text, not the image
    expect(html).not.toContain('.svg'); // Gmail/Outlook strip SVG — never link one
  });
});
