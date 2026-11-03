import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { getStoreEntity, requireStorePermission, StorePolicyError } from "@/lib/store";

const exhibitorSchema = z.object({
  name: z.string().trim().min(2).max(180),
  contactName: z.string().trim().max(180).nullable(),
  email: z.union([z.email(), z.literal("")]).nullable(),
  phone: z.string().trim().max(80).nullable(),
  spaceLabel: z.string().trim().max(120).nullable(),
  rentAmount: z.string().regex(/^\d{1,14}(?:\.\d{1,2})?$/),
  rentCurrency: z.enum(["HTG", "USD"]).nullable(),
  rentPeriod: z.enum(["weekly", "monthly", "one_time"]).nullable(),
  commissionPercent: z.number().min(0).max(100),
  commissionBasis: z.enum(["gross_sales", "net_after_discounts"]),
  status: z.enum(["active", "suspended", "ended"]),
}).strict();

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid exhibitor id." }, { status: 400 });
  const parsed = exhibitorSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid exhibitor details." }, { status: 400 });
  if (Number(parsed.data.rentAmount) > 0 && (!parsed.data.rentCurrency || !parsed.data.rentPeriod)) {
    return NextResponse.json({ error: "Currency and rent period are required for non-zero rent." }, { status: 400 });
  }
  try {
    await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const store = await getStoreEntity(client);
      await requireStorePermission(client, actor, "store.exhibitor.manage", store.id);
      const result = await client.query(
        `UPDATE exhibitors
         SET name=$2,contact_name=$3,email=NULLIF($4,''),phone=$5,space_label=$6,
             rent_amount=$7::numeric,rent_currency=$8,rent_period=$9,
             commission_pct=$10::numeric,commission_basis=$11,status=$12
         WHERE id=$1`,
        [
          id, parsed.data.name, parsed.data.contactName, parsed.data.email,
          parsed.data.phone, parsed.data.spaceLabel, parsed.data.rentAmount,
          parsed.data.rentCurrency, parsed.data.rentPeriod, parsed.data.commissionPercent,
          parsed.data.commissionBasis, parsed.data.status,
        ],
      );
      if (!result.rowCount) throw new StorePolicyError("Exhibitor not found.", 404);
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof StorePolicyError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Unable to update Store exhibitor.", error);
    return NextResponse.json({ error: "Unable to update Store exhibitor." }, { status: 500 });
  }
}
