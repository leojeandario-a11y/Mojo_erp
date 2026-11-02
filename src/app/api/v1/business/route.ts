import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { withDbUser } from "@/lib/db";

export async function GET() {
  const actor = await getSession();
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  try {
    return await withDbUser(actor.id, null, async (client) => {
      const access = await client.query<{ allowed: boolean }>(
        `SELECT app_has_permission('business.customer.read') OR app_has_permission('business.customer.manage') AS allowed`,
      );
      if (!access.rows[0]?.allowed) return NextResponse.json({ error: "Permission denied." }, { status: 403 });
      const [customers, contacts, interactions, opportunities, reminders, suppliers, partners, history] = await Promise.all([
        client.query(`SELECT c.*, u.full_name AS owner_name FROM customers c LEFT JOIN users u ON u.id=c.owner_id ORDER BY c.created_at DESC`),
        client.query(`SELECT cc.*, c.full_name,c.company_name FROM customer_contacts cc JOIN customers c ON c.id=cc.customer_id ORDER BY cc.full_name`),
        client.query(`SELECT ci.*, c.full_name,c.company_name FROM customer_interactions ci JOIN customers c ON c.id=ci.customer_id ORDER BY ci.occurred_at DESC`),
        client.query(`SELECT o.*, c.full_name,c.company_name,u.full_name AS owner_name,
          COALESCE(SUM(CASE WHEN r.status='pending' THEN 1 ELSE 0 END),0)::int AS pending_reminders
          FROM opportunities o JOIN customers c ON c.id=o.customer_id LEFT JOIN users u ON u.id=o.owner_id
          LEFT JOIN opportunity_reminders r ON r.opportunity_id=o.id
          GROUP BY o.id,c.full_name,c.company_name,u.full_name ORDER BY o.updated_at DESC`),
        client.query(`SELECT r.*,o.title FROM opportunity_reminders r JOIN opportunities o ON o.id=r.opportunity_id ORDER BY r.remind_on`),
        client.query(`SELECT * FROM suppliers ORDER BY name`),
        client.query(`SELECT * FROM partners ORDER BY name`),
        client.query(`SELECT h.*,o.title FROM opportunity_stage_history h JOIN opportunities o ON o.id=h.opportunity_id ORDER BY h.changed_at DESC LIMIT 200`),
      ]);
      return NextResponse.json({
        customers: customers.rows, contacts: contacts.rows, interactions: interactions.rows,
        opportunities: opportunities.rows, reminders: reminders.rows, suppliers: suppliers.rows,
        partners: partners.rows, history: history.rows,
      });
    });
  } catch (error) {
    console.error("Unable to load business data.", error);
    return NextResponse.json({ error: "Unable to load business data." }, { status: 500 });
  }
}
