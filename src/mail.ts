type Mail = {
  kind: "verification" | "password reset";
  to: string;
  code: string;
  url: string;
};

export async function deliverAuthMail(mail: Mail) {
  const subject = mail.kind === "verification" ? "Verify your trykt email" : "Reset your trykt password";
  const text = `${mail.kind}\ncode: ${mail.code}\n${mail.url}`;
  if (process.env.NODE_ENV !== "production") {
    console.info(`\n[trykt mail] ${mail.kind}\nto: ${mail.to}\ncode: ${mail.code}\nurl: ${mail.url}\n`);
    return;
  }
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!key || !from) {
    console.error("[trykt mail] production mail is not configured");
    return;
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ from, to: mail.to, subject, text }),
  });
  if (!response.ok) {
    console.error(`[trykt mail] provider returned ${response.status}`);
  }
}
