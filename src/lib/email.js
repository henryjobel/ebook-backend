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

// Gmail rejects attachments over ~25MB; stay under with headroom for MIME encoding.
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

async function buildAttachment(attachment) {
  if (!attachment?.url) return [];

  try {
    const response = await fetch(attachment.url);
    if (!response.ok) {
      console.warn(`Attachment fetch failed (${response.status}) — sending link only`);
      return [];
    }

    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > MAX_ATTACHMENT_BYTES) {
      console.warn("Ebook file too large to attach — sending link only");
      return [];
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_ATTACHMENT_BYTES) {
      console.warn("Ebook file too large to attach — sending link only");
      return [];
    }

    return [{
      filename: attachment.fileName || "ebook.pdf",
      content: buffer,
      contentType: "application/pdf"
    }];
  } catch (error) {
    console.error("Could not fetch ebook file for attachment — sending link only:", error);
    return [];
  }
}

function buildUpsellHtml(upsellItems) {
  if (!upsellItems?.length) return "";

  const rows = upsellItems.map((item) => `
                <tr>
                  <td style="padding:12px 16px;border-bottom:1px solid #eee;color:#333;font-size:14px;">
                    ${item.title}
                  </td>
                  <td style="padding:12px 16px;border-bottom:1px solid #eee;text-align:right;white-space:nowrap;">
                    ${item.downloadUrl
                      ? `<a href="${item.downloadUrl}" style="display:inline-block;background:#1a1a2e;color:#ffffff;text-decoration:none;padding:8px 18px;border-radius:6px;font-size:13px;font-weight:bold;">ডাউনলোড করুন</a>`
                      : `<span style="color:#888;font-size:12px;">শীঘ্রই আলাদাভাবে পাঠানো হবে</span>`}
                  </td>
                </tr>`).join("");

  return `
              <h3 style="margin:28px 0 8px;color:#1a1a2e;font-size:16px;">🎁 আপনার অর্ডারের অতিরিক্ত প্রোডাক্ট</h3>
              <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee;border-radius:8px;border-collapse:separate;overflow:hidden;">
                ${rows}
              </table>`;
}

function buildUpsellText(upsellItems) {
  if (!upsellItems?.length) return "";
  const lines = upsellItems.map((item) =>
    item.downloadUrl
      ? `- ${item.title}: ${item.downloadUrl}`
      : `- ${item.title}: শীঘ্রই আলাদাভাবে পাঠানো হবে`
  );
  return `\nআপনার অর্ডারের অতিরিক্ত প্রোডাক্ট:\n${lines.join("\n")}\n`;
}

export async function sendEbookDeliveryEmail({ to, customerName, ebookTitle, brandName, downloadUrl, attachment, upsellItems = [] }) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    console.warn("Email not configured — skipping delivery email");
    return;
  }

  if (!to) {
    console.warn("No customer email — skipping delivery email");
    return;
  }

  const transporter = createTransporter();
  const attachments = await buildAttachment(attachment);
  const hasAttachment = attachments.length > 0;
  const senderName = brandName || ebookTitle || "Ebook Store";

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
              <h1 style="margin:0;color:#ffffff;font-size:24px;letter-spacing:0.5px;">আপনার অর্ডার অনুমোদিত হয়েছে</h1>
            </td>
          </tr>

          <tr>
            <td style="padding:36px 40px;">
              <p style="margin:0 0 16px;color:#333;font-size:16px;">প্রিয় <strong>${customerName}</strong>,</p>
              <p style="margin:0 0 24px;color:#555;font-size:15px;line-height:1.6;">
                আপনার পেমেন্ট যাচাই সম্পন্ন হয়েছে। ধন্যবাদ আমাদের পণ্য কেনার জন্য!<br/>
                ${hasAttachment
                  ? "আপনার ইবুকটি (PDF) এই ইমেইলের সাথে সংযুক্ত করা হয়েছে। এছাড়াও নিচের বাটনে ক্লিক করে ডাউনলোড করতে পারবেন:"
                  : "নিচের বাটনে ক্লিক করে আপনার ইবুক ডাউনলোড করুন:"}
              </p>

              <h2 style="margin:0 0 8px;color:#1a1a2e;font-size:18px;">📖 ${ebookTitle}</h2>

              <div style="text-align:center;margin:32px 0;">
                <a href="${downloadUrl}"
                   style="display:inline-block;background:#e63946;color:#ffffff;text-decoration:none;padding:16px 40px;border-radius:6px;font-size:17px;font-weight:bold;letter-spacing:0.3px;">
                  ডাউনলোড করুন →
                </a>
              </div>
              ${buildUpsellHtml(upsellItems)}

              <p style="margin:24px 0 8px;color:#888;font-size:13px;">
                ⏳ ডাউনলোড লিংকগুলো <strong>৭ দিন</strong> পর্যন্ত কার্যকর থাকবে।
              </p>
              <p style="margin:0;color:#888;font-size:13px;">
                কোনো সমস্যা হলে এই ইমেইলটি রিপ্লাই করুন — আমরা সাহায্য করব।
              </p>
            </td>
          </tr>

          <tr>
            <td style="background:#f9f9f9;padding:20px 40px;border-top:1px solid #eee;text-align:center;">
              <p style="margin:0;color:#aaa;font-size:12px;">
                ${senderName} — আপনার অর্ডারের ডেলিভারি ইমেইল।
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

  // A plain-text alternative significantly lowers the spam score of HTML-only mail.
  const text = [
    `প্রিয় ${customerName},`,
    "",
    "আপনার পেমেন্ট যাচাই সম্পন্ন হয়েছে। ধন্যবাদ আমাদের পণ্য কেনার জন্য!",
    "",
    `ইবুক: ${ebookTitle}`,
    `ডাউনলোড লিংক: ${downloadUrl}`,
    buildUpsellText(upsellItems),
    "ডাউনলোড লিংকগুলো ৭ দিন পর্যন্ত কার্যকর থাকবে।",
    "কোনো সমস্যা হলে এই ইমেইলটি রিপ্লাই করুন।",
    "",
    `— ${senderName}`
  ].join("\n");

  await transporter.sendMail({
    from: `"${senderName}" <${process.env.GMAIL_USER}>`,
    to,
    replyTo: process.env.SUPPORT_EMAIL || process.env.GMAIL_USER,
    subject: `আপনার ইবুক ডাউনলোড করুন — ${ebookTitle}`,
    text,
    html,
    attachments
  });

  console.log(`Delivery email sent to ${to}${hasAttachment ? " (with PDF attachment)" : " (link only)"}${upsellItems.length ? ` (+${upsellItems.length} upsell)` : ""}`);
}
