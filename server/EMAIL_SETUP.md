# Email Notifications Setup

The Briech UAS Store Management system supports email notifications for:
- ✅ **Request Approved** - Notifies personnel when their request is approved
- ↩ **Request Returned** - Notifies personnel when their request is marked as returned
- ⚠️ **Low Stock Alerts** - Notifies admin when component quantity drops below minimum stock

## Configuration

Set the following environment variables on your Render web service (or `.env` file for local development):

### Required for Email to Work

```bash
# SMTP Configuration (Gmail example)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# Admin email for low stock alerts
NOTIFICATION_TO_ADMIN=admin@briech-uas.com

# Optional: Custom "from" address
NOTIFICATION_FROM=noreply@briech-uas.com
```

### Gmail Setup

1. **Enable 2-Factor Authentication** on your Gmail account
2. **Generate an App Password**:
   - Go to https://myaccount.google.com/apppasswords
   - Select "Mail" and "Other (Custom name)"
   - Enter "Briech UAS Store" as the name
   - Copy the generated 16-character password
   - Use this as `SMTP_PASS`

### Other Email Providers

#### Outlook/Hotmail
```bash
SMTP_HOST=smtp-mail.outlook.com
SMTP_PORT=587
SMTP_USER=your-email@outlook.com
SMTP_PASS=your-password
```

#### SendGrid
```bash
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=your-sendgrid-api-key
```

#### Custom SMTP
```bash
SMTP_HOST=your-smtp-server.com
SMTP_PORT=587  # or 465 for SSL
SMTP_USER=your-username
SMTP_PASS=your-password
```

## How It Works

### Personnel Email Format

Currently, the system extracts email addresses from the personnel name field if formatted as:
```
John Doe <john.doe@briech-uas.com>
```

If no email is found in the name, notifications will be sent to the admin email (`NOTIFICATION_TO_ADMIN`) for forwarding.

**Future Enhancement**: We can add a separate `email` field to the requests table for better email management.

### Notification Triggers

1. **Request Approved**: Sent when admin clicks "Approve" on a request
2. **Request Returned**: Sent when admin marks a request as "Returned"
3. **Low Stock Alert**: Sent automatically when a component's quantity drops to or below its `min_stock` level after approval

### Testing

To test email notifications:

1. Set up your SMTP credentials in environment variables
2. Create a test request with personnel name: `Test User <your-email@example.com>`
3. Approve the request - you should receive an email
4. Mark it as returned - you should receive another email

## Troubleshooting

### Emails Not Sending

1. **Check logs**: Look at Render logs for email errors
2. **Verify credentials**: Ensure `SMTP_USER` and `SMTP_PASS` are correct
3. **Check firewall**: Ensure SMTP port (587/465) is not blocked
4. **Gmail App Password**: Make sure you're using an App Password, not your regular password

### Common Errors

- `Invalid login`: Wrong username/password or need App Password for Gmail
- `Connection timeout`: SMTP host/port incorrect or firewall blocking
- `No recipient`: Personnel name doesn't contain email and `NOTIFICATION_TO_ADMIN` not set

## Disabling Notifications

To disable email notifications, simply don't set `SMTP_USER` and `SMTP_PASS`. The system will log warnings but continue to function normally.
