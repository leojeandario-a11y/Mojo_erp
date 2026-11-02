import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { hasAnyPermission } from "@/lib/permissions";
import { withDbUser } from "@/lib/db";

export async function POST(request: Request) {
  const actor = await getSession();
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!hasAnyPermission(actor, ["marketing.content.manage", "marketing.campaign.manage", "*"])) return NextResponse.json({ error: "Permission denied." }, { status: 403 });
  const body = await request.json();
  try {
    return await withDbUser(actor.id, null, async (client) => {
      if (body.kind === "content") {
        const row = await client.query(`INSERT INTO content_items(campaign_id,title,content_type,channel,scheduled_at,owner_id,status,body) VALUES(NULLIF($1,'')::uuid,$2,$3,$4,NULLIF($5,'')::timestamptz,NULLIF($6,'')::uuid,$7,$8) RETURNING *`,
          [body.campaignId||"",body.title,body.contentType||"post",body.channel||null,body.scheduledAt||"",body.ownerId||"",body.status||"idea",body.body||null]);
        return NextResponse.json(row.rows[0], { status: 201 });
      }
      if (body.kind === "result") {
        const row = await client.query(`INSERT INTO campaign_results(campaign_id,recorded_on,channel,impressions,clicks,leads,conversions,revenue_generated,currency,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
          [body.campaignId,body.recordedOn,body.channel||null,body.impressions||0,body.clicks||0,body.leads||0,body.conversions||0,body.revenueGenerated||0,body.currency||"USD",body.notes||null]);
        return NextResponse.json(row.rows[0], { status: 201 });
      }
      return NextResponse.json({ error: "Unsupported marketing operation." }, { status: 400 });
    });
  } catch (error) {
    console.error("Unable to save marketing operation.", error);
    return NextResponse.json({ error: "Unable to save marketing operation." }, { status: 500 });
  }
}
