import "server-only";
import webPush from "web-push";
import { after } from "next/server";
import { getPool, withDbUser } from "@/lib/db";

interface VapidConfiguration {
  publicKey: string;
  privateKey: string;
  subject: string;
}

interface QueuedNotification {
  notification_id: string;
  attempts: number;
  user_id: string;
}
interface PushNotification {
  title: string;
  body: string | null;
  link: string | null;
}

function getVapidConfiguration(): VapidConfiguration | null {
  const publicKey = process.env.MOJO_WEB_PUSH_PUBLIC_KEY;
  const privateKey = process.env.MOJO_WEB_PUSH_PRIVATE_KEY;
  const subject = process.env.MOJO_WEB_PUSH_SUBJECT;
  if (!publicKey && !privateKey && !subject) return null;
  if (!publicKey || !privateKey || !subject) {
    throw new Error("Web Push requires MOJO_WEB_PUSH_PUBLIC_KEY, MOJO_WEB_PUSH_PRIVATE_KEY, and MOJO_WEB_PUSH_SUBJECT.");
  }
  if (!/^(mailto:.+|https:\/\/.+)$/.test(subject)) {
    throw new Error("MOJO_WEB_PUSH_SUBJECT must be a mailto: address or HTTPS URL.");
  }
  return { publicKey, privateKey, subject };
}

export function getWebPushPublicKey() {
  return getVapidConfiguration()?.publicKey ?? null;
}

export function schedulePushDeliveryAfterResponse() {
  after(async () => {
    try {
      const result = await processNotificationPushQueue();
      if (result.failed > 0) {
        console.error("Some Web Push notifications remain queued for retry.", { failed: result.failed });
      }
    } catch (error) {
      console.error("Unable to process the Web Push queue after the response.", error);
    }
  });
}

export async function processNotificationPushQueue(limit = 25) {
  const configuration = getVapidConfiguration();
  if (!configuration) return { enabled: false, sent: 0, failed: 0 };
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError("The Web Push queue limit must be between 1 and 100.");
  }
  webPush.setVapidDetails(configuration.subject, configuration.publicKey, configuration.privateKey);

  const pool = getPool();
  const client = await pool.connect();
  let queued: QueuedNotification[];
  try {
    await client.query("BEGIN");
    const result = await client.query<QueuedNotification>(
      `WITH claimable AS (
         SELECT notification_id
         FROM notification_push_queue
         WHERE attempts < 5
           AND (locked_at IS NULL OR locked_at < now() - INTERVAL '10 minutes')
         ORDER BY queued_at, notification_id
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       UPDATE notification_push_queue queue
       SET locked_at = now()
       FROM claimable
       WHERE queue.notification_id = claimable.notification_id
       RETURNING queue.notification_id, queue.attempts, queue.user_id`,
      [limit],
    );
    queued = result.rows;
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  let sent = 0;
  let failed = 0;
  for (const notification of queued) {
    try {
      const delivery = await withDbUser(notification.user_id, null, async (userClient) => {
        const notificationResult = await userClient.query<PushNotification>(
          `SELECT title, body, link FROM notifications
           WHERE id = $1 AND user_id = $2`,
          [notification.notification_id, notification.user_id],
        );
        if (!notificationResult.rowCount) return null;
        const subscriptions = await userClient.query<{
          id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
        }>(
          `SELECT id, endpoint, p256dh, auth
           FROM push_subscriptions
           WHERE user_id = $1`,
          [notification.user_id],
        );
        return { message: notificationResult.rows[0], subscriptions: subscriptions.rows };
      });

      if (!delivery || !delivery.subscriptions.length) {
        await pool.query("DELETE FROM notification_push_queue WHERE notification_id = $1", [notification.notification_id]);
        continue;
      }

      let deliveryFailed = false;
      for (const subscription of delivery.subscriptions) {
        try {
          await webPush.sendNotification({
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          }, JSON.stringify({
            id: notification.notification_id,
            title: delivery.message.title,
            body: delivery.message.body ?? "",
            link: delivery.message.link ?? "/dashboard",
          }));
          sent += 1;
        } catch (error) {
          const statusCode = typeof error === "object" && error !== null && "statusCode" in error
            ? Number(error.statusCode)
            : null;
          if (statusCode === 404 || statusCode === 410) {
            await withDbUser(notification.user_id, null, async (userClient) => userClient.query(
              "DELETE FROM push_subscriptions WHERE id = $1 AND user_id = $2",
              [subscription.id, notification.user_id],
            ));
            continue;
          }
          deliveryFailed = true;
          failed += 1;
          console.error("Web Push delivery failed.", { notificationId: notification.notification_id, statusCode });
        }
      }

      if (deliveryFailed) {
        await pool.query(
          `UPDATE notification_push_queue
           SET attempts = attempts + 1, locked_at = NULL,
               last_error = 'One or more push deliveries failed.'
           WHERE notification_id = $1`,
          [notification.notification_id],
        );
      } else {
        await pool.query("DELETE FROM notification_push_queue WHERE notification_id = $1", [notification.notification_id]);
      }
    } catch (error) {
      failed += 1;
      console.error("Unable to process queued Web Push notification.", {
        notificationId: notification.notification_id,
        error,
      });
      await pool.query(
        `UPDATE notification_push_queue
         SET attempts = attempts + 1, locked_at = NULL,
             last_error = 'Push processing failed.'
         WHERE notification_id = $1`,
        [notification.notification_id],
      );
    }
  }
  return { enabled: true, sent, failed };
}
