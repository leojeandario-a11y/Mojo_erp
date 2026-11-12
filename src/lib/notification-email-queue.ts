import "server-only";
import { getPool, withDbUser } from "@/lib/db";
import { EmailConfigurationError, sendApplicationNotificationEmail } from "@/lib/email";

interface QueuedNotificationEmail {
  notification_id: string;
  user_id: string;
}

interface NotificationEmail {
  email: string;
  full_name: string;
  title: string;
  body: string | null;
  locale: "fr" | "ht" | "en";
}

export async function processNotificationEmailQueue() {
  const pool = getPool();
  const client = await pool.connect();
  let queued: QueuedNotificationEmail[];
  try {
    await client.query("BEGIN");
    const result = await client.query<QueuedNotificationEmail>(
      `SELECT notification_id, user_id
       FROM notification_email_queue
       WHERE sent_at IS NULL AND attempts < 5
         AND (locked_at IS NULL OR locked_at < now() - interval '10 minutes')
       ORDER BY queued_at
       LIMIT 20
       FOR UPDATE SKIP LOCKED`,
    );
    queued = result.rows;
    if (queued.length) {
      await client.query(
        `UPDATE notification_email_queue
         SET locked_at = now()
         WHERE notification_id = ANY($1::uuid[])`,
        [queued.map((item) => item.notification_id)],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  let sent = 0;
  let failed = 0;
  for (const item of queued) {
    try {
      const email = await withDbUser(item.user_id, null, async (recipientClient) => {
        const result = await recipientClient.query<NotificationEmail>(
          `SELECT user_record.email::text, user_record.full_name, notification.title, notification.body,
                  user_record.locale
           FROM users user_record
           JOIN notifications notification ON notification.user_id = user_record.id
           WHERE user_record.id = $1 AND user_record.is_active
             AND notification.id = $2`,
          [item.user_id, item.notification_id],
        );
        return result.rows[0] ?? null;
      });
      if (!email) {
        await pool.query(
          `UPDATE notification_email_queue
           SET attempts = 5, locked_at = NULL, last_error = 'Recipient or notification is no longer available.'
           WHERE notification_id = $1 AND sent_at IS NULL`,
          [item.notification_id],
        );
        failed += 1;
        continue;
      }

      await sendApplicationNotificationEmail(
        email.email,
        email.full_name,
        email.title,
        email.body ?? "",
        email.locale,
      );
      await pool.query(
        `UPDATE notification_email_queue
         SET sent_at = now(), locked_at = NULL, last_error = NULL
         WHERE notification_id = $1 AND sent_at IS NULL`,
        [item.notification_id],
      );
      sent += 1;
    } catch (error) {
      if (error instanceof EmailConfigurationError) {
        await pool.query(
          `UPDATE notification_email_queue
           SET locked_at = NULL, last_error = $2
           WHERE notification_id = $1 AND sent_at IS NULL`,
          [item.notification_id, error.message.slice(0, 500)],
        );
        failed += 1;
        continue;
      }
      console.error("Unable to deliver a queued notification email.", error);
      await pool.query(
        `UPDATE notification_email_queue
         SET attempts = attempts + 1, locked_at = NULL, last_error = $2
         WHERE notification_id = $1 AND sent_at IS NULL`,
        [
          item.notification_id,
          error instanceof Error ? error.message.slice(0, 500) : "Unknown email delivery error.",
        ],
      );
      failed += 1;
    }
  }

  return { queued: queued.length, sent, failed };
}
