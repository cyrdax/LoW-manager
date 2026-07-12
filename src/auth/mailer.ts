import type { FastifyBaseLogger } from 'fastify';
import type { AuthMailer } from './app-auth-routes.ts';

const RESEND_EMAILS_ENDPOINT = 'https://api.resend.com/emails';

export interface ResendAuthMailerOptions {
  apiKey: string;
  from: string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
}

export function createAuthMailerFromEnv(logger?: Pick<FastifyBaseLogger, 'info'>): AuthMailer {
  const mode = process.env.EMAIL_MODE?.trim().toLowerCase();
  if (mode === 'dev') return createDevAuthMailer(logger);

  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  if (apiKey && from) return createResendAuthMailer({ apiKey, from });

  if (mode === 'resend') {
    throw new Error('EMAIL_MODE=resend requires RESEND_API_KEY and EMAIL_FROM');
  }

  return createDevAuthMailer(logger);
}

export function createDevAuthMailer(logger?: Pick<FastifyBaseLogger, 'info'>): AuthMailer {
  return {
    async sendEmailVerification(input) {
      logger?.info(`[auth] verification for ${input.to}: ${input.verificationUrl}`);
    },
    async sendPasswordReset(input) {
      logger?.info(`[auth] password reset for ${input.to}: ${input.resetUrl}`);
    },
  };
}

export function createResendAuthMailer(options: ResendAuthMailerOptions): AuthMailer {
  const endpoint = options.endpoint ?? RESEND_EMAILS_ENDPOINT;
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async sendEmailVerification(input) {
      await sendResendEmail(fetchImpl, endpoint, options.apiKey, {
        from: options.from,
        to: [input.to],
        subject: 'Verify your LoW Manager email',
        html: actionEmailHtml({
          title: 'Verify your email',
          body: 'Use this link to finish creating your LoW Manager account.',
          actionLabel: 'Verify email',
          actionUrl: input.verificationUrl,
        }),
        text: actionEmailText({
          body: 'Use this link to finish creating your LoW Manager account.',
          actionUrl: input.verificationUrl,
        }),
      });
    },
    async sendPasswordReset(input) {
      await sendResendEmail(fetchImpl, endpoint, options.apiKey, {
        from: options.from,
        to: [input.to],
        subject: 'Reset your LoW Manager password',
        html: actionEmailHtml({
          title: 'Reset your password',
          body: 'Use this link to reset your LoW Manager password.',
          actionLabel: 'Reset password',
          actionUrl: input.resetUrl,
        }),
        text: actionEmailText({
          body: 'Use this link to reset your LoW Manager password.',
          actionUrl: input.resetUrl,
        }),
      });
    },
  };
}

async function sendResendEmail(
  fetchImpl: typeof fetch,
  endpoint: string,
  apiKey: string,
  body: {
    from: string;
    to: string[];
    subject: string;
    html: string;
    text: string;
  },
): Promise<void> {
  const res = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await resendErrorDetail(res);
    throw new Error(`Resend email failed (${res.status}): ${detail}`);
  }
}

async function resendErrorDetail(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  if (!text) return res.statusText || 'unknown error';
  try {
    const parsed = JSON.parse(text) as { message?: unknown; error?: unknown };
    const message = parsed.message ?? parsed.error;
    if (typeof message === 'string' && message.trim()) return message;
  } catch {
    // Fall through to raw text.
  }
  return text.slice(0, 500);
}

function actionEmailHtml(input: {
  title: string;
  body: string;
  actionLabel: string;
  actionUrl: string;
}): string {
  const title = escapeHtml(input.title);
  const body = escapeHtml(input.body);
  const label = escapeHtml(input.actionLabel);
  const url = escapeHtml(input.actionUrl);
  return `<!doctype html>
<html>
  <body style="margin:0;background:#0f131a;color:#e8edf5;font-family:Arial,sans-serif;padding:32px">
    <div style="max-width:560px;margin:0 auto">
      <h1 style="font-size:24px;margin:0 0 16px">${title}</h1>
      <p style="font-size:16px;line-height:1.5;margin:0 0 24px">${body}</p>
      <p style="margin:0 0 24px">
        <a href="${url}" style="display:inline-block;background:#5da2ff;color:#06101f;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:6px">${label}</a>
      </p>
      <p style="font-size:13px;line-height:1.5;color:#aab4c4;margin:0">If the button does not work, paste this link into your browser:<br>${url}</p>
    </div>
  </body>
</html>`;
}

function actionEmailText(input: { body: string; actionUrl: string }): string {
  return `${input.body}\n\n${input.actionUrl}\n`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
