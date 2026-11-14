import { Resend } from "resend";

export async function sendEmail(
  env: Env,
  message: { to: string; subject: string; html: string },
) {
  const resend = new Resend(env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: env.EMAIL_FROM,
    to: [message.to],
    subject: message.subject,
    html: message.html,
  });

  if (error) {
    console.error(`Email "${message.subject}" failed: ${error.message}`);
  }
}
