import "server-only";
import { getPool, withDbUser } from "@/lib/db";
import { reportDefinitions, type ReportCategory } from "@/lib/reports";
import { nextReportRun } from "@/lib/report-schedule.mjs";
import { processNotificationPushQueue } from "@/lib/web-push";

type Frequency = "daily" | "weekly" | "monthly";

interface DueSchedule {
  id: string;
  owner_id: string;
  category: ReportCategory;
  frequency: Frequency;
  entity_id: string | null;
  window_days: number;
  next_run_at: Date | string;
}

const categoryName: Record<ReportCategory, { fr: string; ht: string; en: string }> = {
  finance: { fr: "Finance", ht: "Finans", en: "Finance" },
  hr: { fr: "Ressources humaines", ht: "Resous imèn", en: "Human resources" },
  business: { fr: "Affaires", ht: "Biznis", en: "Commercial" },
  marketing: { fr: "Marketing", ht: "Maketing", en: "Marketing" },
  operations: { fr: "Opérations", ht: "Operasyon", en: "Operations" },
  store: { fr: "MOJO Store", ht: "MOJO Store", en: "MOJO Store" },
};

const title = {
  fr: "Rapport planifié à consulter",
  ht: "Rapò pwograme pou konsilte",
  en: "Scheduled report is due",
};

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export async function runScheduledReports() {
  const claimed = await getPool().query<DueSchedule>("SELECT * FROM claim_due_report_schedules()");
  let created = 0;
  let disabled = 0;
  let failed = 0;

  for (const schedule of claimed.rows) {
    try {
      const notificationCreated = await withDbUser(schedule.owner_id, null, async (client) => {
        const definition = reportDefinitions[schedule.category];
        const permission = await client.query<{ allowed: boolean }>(
          `SELECT CASE WHEN $2::uuid IS NULL
            THEN app_has_permission($1)
            ELSE app_has_entity_permission($1, $2::uuid)
          END AS allowed`,
          [definition.permission, schedule.entity_id],
        );
        if (!permission.rows[0]?.allowed) {
          await client.query(
            "UPDATE report_schedules SET is_active = false, locked_until = NULL WHERE id = $1 AND owner_id = $2",
            [schedule.id, schedule.owner_id],
          );
          return "disabled" as const;
        }

        const owner = await client.query<{ locale: "fr" | "ht" | "en"; is_active: boolean }>(
          "SELECT locale, is_active FROM users WHERE id = $1",
          [schedule.owner_id],
        );
        if (!owner.rows[0]?.is_active) {
          await client.query(
            "UPDATE report_schedules SET is_active = false, locked_until = NULL WHERE id = $1 AND owner_id = $2",
            [schedule.id, schedule.owner_id],
          );
          return "disabled" as const;
        }

        const now = new Date();
        const to = isoDate(now);
        const fromDate = new Date(now);
        fromDate.setUTCDate(fromDate.getUTCDate() - schedule.window_days + 1);
        const from = isoDate(fromDate);
        const locale = owner.rows[0].locale;
        const period = new Date(schedule.next_run_at).toISOString();
        const eventKey = `report_schedule:${schedule.id}:${period}`;
        const delivery = await client.query(
          `INSERT INTO scheduled_notification_deliveries(event_key, recipient_id)
           VALUES ($1, $2)
           ON CONFLICT (event_key) DO NOTHING
           RETURNING event_key`,
          [eventKey, schedule.owner_id],
        );
        let notificationId: string | null = null;
        if (delivery.rowCount) {
          const notification = await client.query<{ id: string }>(
            `INSERT INTO notifications(user_id, kind, title, body, link, ref_table, ref_id)
             VALUES ($1, 'scheduled_report', $2, $3, $4, 'report_schedules', $5)
             RETURNING id`,
            [
              schedule.owner_id,
              title[locale],
              `${categoryName[schedule.category][locale]} · ${from} – ${to}`,
              `/modules/reports?category=${schedule.category}&from=${from}&to=${to}${schedule.entity_id ? `&entityId=${schedule.entity_id}` : ""}`,
              schedule.id,
            ],
          );
          notificationId = notification.rows[0]?.id ?? null;
          if (notificationId) {
            await client.query(
              "UPDATE scheduled_notification_deliveries SET notification_id = $2 WHERE event_key = $1",
              [eventKey, notificationId],
            );
          } else {
            await client.query("DELETE FROM scheduled_notification_deliveries WHERE event_key = $1", [eventKey]);
          }
        }

        const nextRunAt = nextReportRun(schedule.frequency);
        await client.query(
          `UPDATE report_schedules
           SET last_run_at = now(), next_run_at = $3, locked_until = NULL
           WHERE id = $1 AND owner_id = $2`,
          [schedule.id, schedule.owner_id, nextRunAt],
        );
        return notificationId ? "created" as const : "already_delivered" as const;
      });

      if (notificationCreated === "created") created += 1;
      if (notificationCreated === "disabled") disabled += 1;
    } catch (error) {
      failed += 1;
      console.error(`Unable to deliver scheduled report ${schedule.id}.`, error);
      try {
        await withDbUser(schedule.owner_id, null, async (client) => {
          await client.query(
            "UPDATE report_schedules SET locked_until = NULL WHERE id = $1 AND owner_id = $2",
            [schedule.id, schedule.owner_id],
          );
        });
      } catch (unlockError) {
        console.error(`Unable to release scheduled report ${schedule.id}.`, unlockError);
      }
    }
  }

  const push = claimed.rowCount ? await processNotificationPushQueue() : null;
  return { candidates: claimed.rowCount, created, disabled, failed, push };
}
