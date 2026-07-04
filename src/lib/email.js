import nodemailer from "nodemailer";

function createTransporter() {
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD
    }
  });
}

export async function sendEbookDeliveryEmail({ to, customerName, ebookTitle, downloadUrl }) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    console.warn("Email not configured — skipping delivery email");
    return;
  }

  if (!to) {
    console.warn("No customer email — skipping delivery email");
    return;
  }

  const transporter = createTransporter();

  const html = `
<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>আপনার ইবুক প্রস্তুত</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:30px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

          <tr>
            <td style="background:#1a1a2e;padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:24px;letter-spacing:0.5px;">🎉 আপনার অর্ডার অনুমোদিত হয়েছে!</h1>
            </td>
          </tr>

          <tr>
            <td style="padding:36px 40px;">
              <p style="margin:0 0 16px;color:#333;font-size:16px;">প্রিয় <strong>${customerName}</strong>,</p>
              <p style="margin:0 0 24px;color:#555;font-size:15px;line-height:1.6;">
                আপনার পেমেন্ট যাচাই সম্পন্ন হয়েছে। ধন্যবাদ আমাদের পণ্য কেনার জন্য!<br/>
                নিচের বাটনে ক্লিক করে আপনার ইবুক ডাউনলোড করুন:
              </p>

              <h2 style="margin:0 0 8px;color:#1a1a2e;font-size:18px;">📖 ${ebookTitle}</h2>

              <div style="text-align:center;margin:32px 0;">
                <a href="${downloadUrl}"
                   style="display:inline-block;background:#e63946;color:#ffffff;text-decoration:none;padding:16px 40px;border-radius:6px;font-size:17px;font-weight:bold;letter-spacing:0.3px;">
                  ডাউনলোড করুন →
                </a>
              </div>

              <p style="margin:0 0 8px;color:#888;font-size:13px;">
                ⏳ এই লিংকটি <strong>৭ দিন</strong> পর্যন্ত কার্যকর থাকবে।
              </p>
              <p style="margin:0;color:#888;font-size:13px;">
                কোনো সমস্যা হলে এই ইমেইলটি রিপ্লাই করুন।
              </p>
            </td>
          </tr>

          <tr>
            <td style="background:#f9f9f9;padding:20px 40px;border-top:1px solid #eee;text-align:center;">
              <p style="margin:0;color:#aaa;font-size:12px;">
                এই ইমেইল স্বয়ংক্রিয়ভাবে পাঠানো হয়েছে। অনুগ্রহ করে সরাসরি উত্তর দেবেন না।
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  await transporter.sendMail({
    from: `"${ebookTitle}" <${process.env.GMAIL_USER}>`,
    to,
    subject: `✅ আপনার ইবুক ডাউনলোডের লিংক — ${ebookTitle}`,
    html
  });

  console.log(`Delivery email sent to ${to}`);
}
