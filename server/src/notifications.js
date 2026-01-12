const nodemailer = require("nodemailer");

// Email configuration from environment variables
const SMTP_HOST = process.env.SMTP_HOST || "smtp.gmail.com";
const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
const SMTP_USER = process.env.SMTP_USER; // Email address
const SMTP_PASS = process.env.SMTP_PASS; // App password or regular password
const NOTIFICATION_FROM = process.env.NOTIFICATION_FROM || SMTP_USER || "noreply@briech-uas.com";
const NOTIFICATION_TO_ADMIN = process.env.NOTIFICATION_TO_ADMIN || ""; // Admin email for alerts

// Create transporter (only if credentials are provided)
let transporter = null;
if (SMTP_USER && SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465, // true for 465, false for other ports
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });
}

/**
 * Send email notification
 */
async function sendEmail({ to, subject, html, text }) {
  if (!transporter) {
    console.warn("Email not configured. Set SMTP_USER and SMTP_PASS environment variables.");
    return { success: false, error: "Email not configured" };
  }

  if (!to) {
    console.warn("No recipient email provided");
    return { success: false, error: "No recipient" };
  }

  try {
    const info = await transporter.sendMail({
      from: `"Briech UAS Store" <${NOTIFICATION_FROM}>`,
      to: Array.isArray(to) ? to.join(", ") : to,
      subject,
      text,
      html,
    });

    console.log("Email sent:", info.messageId);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error("Email send error:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Notify personnel when their request is approved
 */
async function notifyRequestApproved(request) {
  const { personnelName, department, items, requestedAt } = request;
  
  // Try to extract email from personnel name (if format is "Name <email>")
  // Otherwise, we'll need to store emails separately in the future
  let recipientEmail = null;
  if (personnelName.includes("<") && personnelName.includes(">")) {
    const match = personnelName.match(/<(.+)>/);
    recipientEmail = match ? match[1] : null;
  }

  // For now, if no email in name, skip (or send to admin to forward)
  if (!recipientEmail && NOTIFICATION_TO_ADMIN) {
    recipientEmail = NOTIFICATION_TO_ADMIN;
  }

  if (!recipientEmail) {
    console.log(`No email found for ${personnelName}, skipping approval notification`);
    return { success: false, error: "No email address" };
  }

  const itemsList = items
    .map((item) => `  • ${item.componentName || "Item"}: ${item.quantity} ${item.unit || "pcs"}`)
    .join("\n");

  const subject = `✅ Request Approved - Briech UAS Store`;
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #2563eb; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
        .content { background: #f9fafb; padding: 20px; border-radius: 0 0 8px 8px; }
        .status { background: #10b981; color: white; padding: 8px 16px; border-radius: 4px; display: inline-block; margin: 10px 0; }
        .items { background: white; padding: 15px; border-radius: 4px; margin: 15px 0; }
        .footer { text-align: center; margin-top: 20px; color: #6b7280; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2>Request Approved</h2>
        </div>
        <div class="content">
          <p>Hello ${personnelName},</p>
          <p>Your request has been <span class="status">APPROVED</span> and items are ready for pickup.</p>
          
          <div class="items">
            <strong>Requested Items:</strong>
            <pre style="margin: 10px 0; font-family: inherit;">${itemsList}</pre>
          </div>
          
          <p><strong>Department:</strong> ${department || "N/A"}</p>
          <p><strong>Requested At:</strong> ${new Date(requestedAt).toLocaleString()}</p>
          
          <p>Please visit the store to collect your items.</p>
          
          <div class="footer">
            <p>Briech UAS Store Management System</p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `
Request Approved - Briech UAS Store

Hello ${personnelName},

Your request has been APPROVED and items are ready for pickup.

Requested Items:
${itemsList}

Department: ${department || "N/A"}
Requested At: ${new Date(requestedAt).toLocaleString()}

Please visit the store to collect your items.

Briech UAS Store Management System
  `;

  return await sendEmail({ to: recipientEmail, subject, html, text });
}

/**
 * Notify personnel when their request is returned
 */
async function notifyRequestReturned(request) {
  const { personnelName, department, items, requestedAt, returnedAt } = request;
  
  let recipientEmail = null;
  if (personnelName.includes("<") && personnelName.includes(">")) {
    const match = personnelName.match(/<(.+)>/);
    recipientEmail = match ? match[1] : null;
  }

  if (!recipientEmail && NOTIFICATION_TO_ADMIN) {
    recipientEmail = NOTIFICATION_TO_ADMIN;
  }

  if (!recipientEmail) {
    console.log(`No email found for ${personnelName}, skipping return notification`);
    return { success: false, error: "No email address" };
  }

  const itemsList = items
    .map((item) => `  • ${item.componentName || "Item"}: ${item.quantity} ${item.unit || "pcs"}`)
    .join("\n");

  const subject = `↩ Request Returned - Briech UAS Store`;
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #10b981; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
        .content { background: #f9fafb; padding: 20px; border-radius: 0 0 8px 8px; }
        .status { background: #10b981; color: white; padding: 8px 16px; border-radius: 4px; display: inline-block; margin: 10px 0; }
        .items { background: white; padding: 15px; border-radius: 4px; margin: 15px 0; }
        .footer { text-align: center; margin-top: 20px; color: #6b7280; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2>Request Returned</h2>
        </div>
        <div class="content">
          <p>Hello ${personnelName},</p>
          <p>Your request has been marked as <span class="status">RETURNED</span>.</p>
          
          <div class="items">
            <strong>Returned Items:</strong>
            <pre style="margin: 10px 0; font-family: inherit;">${itemsList}</pre>
          </div>
          
          <p><strong>Department:</strong> ${department || "N/A"}</p>
          <p><strong>Requested At:</strong> ${new Date(requestedAt).toLocaleString()}</p>
          <p><strong>Returned At:</strong> ${new Date(returnedAt).toLocaleString()}</p>
          
          <p>Thank you for returning the items.</p>
          
          <div class="footer">
            <p>Briech UAS Store Management System</p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `
Request Returned - Briech UAS Store

Hello ${personnelName},

Your request has been marked as RETURNED.

Returned Items:
${itemsList}

Department: ${department || "N/A"}
Requested At: ${new Date(requestedAt).toLocaleString()}
Returned At: ${new Date(returnedAt).toLocaleString()}

Thank you for returning the items.

Briech UAS Store Management System
  `;

  return await sendEmail({ to: recipientEmail, subject, html, text });
}

/**
 * Notify admin about low stock items
 */
async function notifyLowStock(component) {
  if (!NOTIFICATION_TO_ADMIN) {
    console.log("No admin email configured for low stock alerts");
    return { success: false, error: "No admin email" };
  }

  const { name, quantity, minStock, category, location } = component;

  const subject = `⚠️ Low Stock Alert - ${name}`;
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #f59e0b; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
        .content { background: #f9fafb; padding: 20px; border-radius: 0 0 8px 8px; }
        .alert { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 15px 0; }
        .footer { text-align: center; margin-top: 20px; color: #6b7280; font-size: 12px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2>⚠️ Low Stock Alert</h2>
        </div>
        <div class="content">
          <div class="alert">
            <strong>${name}</strong> is running low on stock!
          </div>
          
          <p><strong>Current Quantity:</strong> ${quantity}</p>
          <p><strong>Minimum Stock Level:</strong> ${minStock}</p>
          <p><strong>Category:</strong> ${category || "N/A"}</p>
          <p><strong>Location:</strong> ${location || "N/A"}</p>
          
          <p>Please consider restocking this item soon.</p>
          
          <div class="footer">
            <p>Briech UAS Store Management System</p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `
Low Stock Alert - Briech UAS Store

${name} is running low on stock!

Current Quantity: ${quantity}
Minimum Stock Level: ${minStock}
Category: ${category || "N/A"}
Location: ${location || "N/A"}

Please consider restocking this item soon.

Briech UAS Store Management System
  `;

  return await sendEmail({ to: NOTIFICATION_TO_ADMIN, subject, html, text });
}

module.exports = {
  sendEmail,
  notifyRequestApproved,
  notifyRequestReturned,
  notifyLowStock,
};
