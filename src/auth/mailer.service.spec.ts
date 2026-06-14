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
});
