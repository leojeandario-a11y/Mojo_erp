import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession, hasPermission } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { isApplicationEmailConfigured } from "@/lib/email";
import { getDirectorDepartmentCode } from "@/lib/collaboration-roles";

const departmentCodes = ["DAF", "DRH", "AFF", "MKT", "OPS", "STORE"] as const;
const createSchema = z.object({
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(5000),
  audienceType: z.enum(["all", "department", "selected"]),
  departmentCode: z.enum(departmentCodes).optional(),
  userIds: z.array(z.uuid()).max(100).default([]),
}).strict().superRefine((value, context) => {
  if (value.audienceType === "department" && !value.departmentCode) {
    context.addIssue({ code: "custom", path: ["departmentCode"], message: "Choose a department." });
  }
  if (value.audienceType !== "department" && value.departmentCode) {
    context.addIssue({ code: "custom", path: ["departmentCode"], message: "Department is not used for this audience." });
  }
  if (value.audienceType === "selected" && value.userIds.length === 0) {
    context.addIssue({ code: "custom", path: ["userIds"], message: "Choose at least one recipient." });
  }
  if (value.audienceType !== "selected" && value.userIds.length > 0) {
    context.addIssue({ code: "custom", path: ["userIds"], message: "Recipients are not used for this audience." });
  }
});

export async function GET(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  try {
    const announcements = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const result = await client.query(
        `SELECT announcement.id, announcement.title, announcement.body,
                announcement.audience_type, announcement.department_code,
                announcement.created_at::text, author.full_name AS created_by_name
         FROM collaboration_announcements announcement
         JOIN users author ON author.id = announcement.created_by
         WHERE announcement.created_by = $1
            OR EXISTS (
              SELECT 1 FROM collaboration_announcement_recipients recipient
              WHERE recipient.announcement_id = announcement.id AND recipient.user_id = $1
            )
         ORDER BY announcement.created_at DESC
         LIMIT 50`,
        [actor.id],
      );
      return result.rows;
    });
    return NextResponse.json({
      announcements,
      emailConfigured: isApplicationEmailConfigured(),
      emailWorkerConfigured: Boolean(
        process.env.MOJO_SCHEDULED_TASK_TOKEN
        && process.env.MOJO_SCHEDULED_TASK_TOKEN.length >= 32,
      ),
    });
  } catch (error) {
    console.error("Unable to load collaboration announcements.", error);
    return NextResponse.json({ error: "Unable to load announcements." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid announcement." }, { status: 400 });

  const canSendGlobal = hasPermission(actor, "collaboration.announcement.global");
  const canSendDepartment = hasPermission(actor, "collaboration.announcement.department");
  if (
    (parsed.data.audienceType === "all" && !canSendGlobal)
    || (parsed.data.audienceType !== "all" && !canSendGlobal && !canSendDepartment)
  ) {
    return NextResponse.json({ error: "You are not allowed to send this announcement." }, { status: 403 });
  }

  const ownDepartmentCode = getDirectorDepartmentCode(actor.roles);
  if (
    parsed.data.audienceType === "department"
    && !canSendGlobal
    && parsed.data.departmentCode !== ownDepartmentCode
  ) {
    return NextResponse.json({ error: "You can only announce to your own department." }, { status: 403 });
  }

  try {
    const created = await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      let recipientIds: string[];
      if (parsed.data.audienceType === "all") {
        const recipients = await client.query<{ id: string }>(
          "SELECT id FROM users WHERE is_active ORDER BY id",
        );
        recipientIds = recipients.rows.map((row) => row.id);
      } else if (parsed.data.audienceType === "department") {
        const departmentCode = parsed.data.departmentCode!;
        const department = await client.query<{ exists: boolean }>(
          `SELECT EXISTS (SELECT 1 FROM departments WHERE code = $1) AS exists`,
          [departmentCode],
        );
        if (!department.rows[0]?.exists && departmentCode !== "STORE") {
          throw new AnnouncementValidationError("Department not found.");
        }
        const recipients = await client.query<{ id: string }>(
          `SELECT DISTINCT user_record.id
           FROM users user_record
           LEFT JOIN departments department ON department.id = user_record.department_id
           WHERE user_record.is_active
             AND (
               department.code = $1
               OR ($1 = 'STORE' AND EXISTS (
                 SELECT 1
                 FROM user_roles user_role
                 JOIN roles role ON role.id = user_role.role_id
                 WHERE user_role.user_id = user_record.id
                   AND role.code IN ('stock_manager', 'caissier')
               ))
             )
           ORDER BY user_record.id`,
          [departmentCode],
        );
        recipientIds = recipients.rows.map((row) => row.id);
      } else {
        const uniqueIds = [...new Set(parsed.data.userIds)];
        const recipients = await client.query<{ id: string }>(
          `SELECT id FROM users
           WHERE is_active AND id = ANY($1::uuid[])
           ORDER BY id`,
          [uniqueIds],
        );
        if (recipients.rowCount !== uniqueIds.length) {
          throw new AnnouncementValidationError("One or more recipients are unavailable.");
        }
        recipientIds = recipients.rows.map((row) => row.id);
      }

      if (!recipientIds.includes(actor.id)) recipientIds.push(actor.id);
      if (!recipientIds.length) throw new AnnouncementValidationError("There are no active recipients.");

      const announcement = await client.query<{ id: string }>(
        `INSERT INTO collaboration_announcements(
           title, body, audience_type, department_code, created_by
         )
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [
          parsed.data.title,
          parsed.data.body,
          parsed.data.audienceType,
          parsed.data.audienceType === "department" ? parsed.data.departmentCode : null,
          actor.id,
        ],
      );
      const announcementId = announcement.rows[0].id;
      await client.query(
        `INSERT INTO collaboration_announcement_recipients(announcement_id, user_id)
         SELECT $1, recipient_id
         FROM unnest($2::uuid[]) AS recipient_id`,
        [announcementId, recipientIds],
      );
      await client.query(
        `INSERT INTO notifications(user_id, kind, title, body, link, ref_table, ref_id)
         SELECT recipient_id, 'announcement', $2, $3, '/collaboration',
                'collaboration_announcements', $1
         FROM unnest($4::uuid[]) AS recipient_id`,
        [announcementId, parsed.data.title, parsed.data.body, recipientIds],
      );
      return { id: announcementId, recipientCount: recipientIds.length };
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof AnnouncementValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Unable to create collaboration announcement.", error);
    return NextResponse.json({ error: "Unable to send announcement." }, { status: 500 });
  }
}

class AnnouncementValidationError extends Error {}
