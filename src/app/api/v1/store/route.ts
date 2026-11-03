import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requestIp, withDbUser } from "@/lib/db";
import { canStorePermission, getStoreEntity } from "@/lib/store";
import { csvCell } from "@/lib/csv.mjs";

const storePermissions = [
  "store.product.read",
  "store.product.manage",
  "store.stock.manage",
  "store.pos.sell",
  "store.exhibitor.manage",
  "store.report.read",
  "store.finance.read",
  "store.pos.configure",
  "store.pos.return",
  "store.pos.void",
  "store.exhibitor.validate",
  "store.exhibitor.pay",
] as const;

export async function GET(request: Request) {
  const actor = await getSession(request.headers);
  if (!actor) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  try {
    return await withDbUser(actor.id, requestIp(request.headers), async (client) => {
      const store = await getStoreEntity(client);
      const allowed = await Promise.all(storePermissions.map((permission) =>
        canStorePermission(client, actor, permission, store.id),
      ));
      if (!allowed.some(Boolean)) return NextResponse.json({ error: "Permission denied." }, { status: 403 });
      const permissions = Object.fromEntries(storePermissions.map((permission, index) => [permission, allowed[index]]));
      const canReadCatalog = permissions["store.product.read"]
        || permissions["store.product.manage"] || permissions["store.stock.manage"] || permissions["store.pos.sell"]
        || permissions["store.report.read"];
      const canReadSales = permissions["store.pos.sell"] || permissions["store.report.read"]
        || permissions["store.pos.return"] || permissions["store.pos.void"];
      const { rows: [businessDate] } = await client.query<{ today: string }>("SELECT CURRENT_DATE::text AS today");
      const categories = canReadCatalog
        ? await client.query<{ id: string; name: string; parent_id: string | null; is_active: boolean }>(
          "SELECT id, name, parent_id, is_active FROM product_categories WHERE is_active OR $1 ORDER BY name",
          [permissions["store.product.manage"]],
        )
        : await client.query<{ id: string; name: string; parent_id: string | null; is_active: boolean }>(
          "SELECT NULL::uuid AS id,''::text AS name,NULL::uuid AS parent_id,false AS is_active WHERE false",
        );
      const products = canReadCatalog
        ? await client.query(
          `SELECT p.id, p.sku, p.barcode, p.name, p.category_id, c.name AS category,
                  p.supplier_id, s.name AS supplier, p.exhibitor_id, x.name AS exhibitor,
                  p.purchase_price::text, p.sale_price::text, p.price_currency,
                  p.min_stock, p.image_path, p.status,
                  COALESCE(SUM(m.quantity), 0)::text AS quantity,
                  COALESCE(SUM(m.quantity), 0) <= p.min_stock AS is_low
           FROM products p
           LEFT JOIN product_categories c ON c.id = p.category_id
           LEFT JOIN suppliers s ON s.id = p.supplier_id
           LEFT JOIN exhibitors x ON x.id = p.exhibitor_id
           LEFT JOIN stock_movements m
             ON m.product_id = p.id
            AND m.location_id = (SELECT id FROM stock_locations WHERE is_default ORDER BY name LIMIT 1)
           WHERE p.entity_id = $1
           GROUP BY p.id, c.name, s.name, x.name
           ORDER BY p.name`,
          [store.id],
        )
        : await client.query("SELECT NULL::uuid AS id WHERE false");
      const locations = permissions["store.stock.manage"] || permissions["store.product.read"] || permissions["store.pos.sell"]
        ? await client.query("SELECT id, name, is_default FROM stock_locations WHERE is_default ORDER BY name")
        : await client.query("SELECT NULL::uuid AS id,''::text AS name,false AS is_default WHERE false");
      const suppliers = canReadCatalog
        ? await client.query("SELECT id, name FROM suppliers ORDER BY name")
        : await client.query("SELECT NULL::uuid AS id,''::text AS name WHERE false");
      const accounts = permissions["store.pos.sell"] || permissions["store.finance.read"] || permissions["store.exhibitor.pay"]
        || permissions["store.pos.return"] || permissions["store.pos.void"]
        ? await client.query(
          `SELECT id, name, account_type, currency, cash_ceiling::text,
                  cash_variance_tolerance::text
           FROM accounts WHERE entity_id = $1 AND is_active ORDER BY account_type, name`,
          [store.id],
        )
        : await client.query("SELECT NULL::uuid AS id WHERE false");
      const customers = permissions["store.pos.sell"]
        ? await client.query(
          `SELECT id, COALESCE(NULLIF(company_name, ''), full_name) AS name
           FROM customers ORDER BY name LIMIT 500`,
        )
        : await client.query("SELECT NULL::uuid AS id,''::text AS name WHERE false");
      const exchangeRate = permissions["store.pos.sell"]
        ? await client.query<{ rate: string | null }>(
          `SELECT CASE WHEN from_currency = 'USD' THEN rate::numeric(18,8)::text
                       ELSE (1 / rate)::numeric(18,8)::text END AS rate
           FROM exchange_rates
           WHERE rate_date <= CURRENT_DATE
             AND ((from_currency = 'USD' AND to_currency = 'HTG')
               OR (from_currency = 'HTG' AND to_currency = 'USD'))
           ORDER BY rate_date DESC, created_at DESC LIMIT 1`,
        )
        : await client.query<{ rate: string | null }>("SELECT NULL::text AS rate WHERE false");
      const sales = canReadSales
        ? await client.query(
          `SELECT s.id, s.receipt_number, s.sold_at, s.currency, s.subtotal::text,
                  s.discount::text, s.total::text, s.status, u.full_name AS cashier,
                  COALESCE(jsonb_agg(jsonb_build_object(
                    'name', p.name, 'sku', p.sku, 'quantity', i.quantity::text,
                    'lineTotal', i.line_total::text
                  )) FILTER (WHERE i.id IS NOT NULL), '[]'::jsonb) AS items
           FROM sales s
           JOIN users u ON u.id = s.cashier_id
           LEFT JOIN sale_items i ON i.sale_id = s.id
           LEFT JOIN products p ON p.id = i.product_id
           WHERE s.entity_id = $1
           GROUP BY s.id, u.full_name
           ORDER BY s.sold_at DESC LIMIT 100`,
          [store.id],
        )
        : await client.query("SELECT NULL::uuid AS id WHERE false");
      const metrics = canReadSales
        ? await client.query(
          `SELECT COUNT(*) FILTER (WHERE status = 'completed')::int AS sales_today,
                  COALESCE(SUM(total * fx_rate_to_usd) FILTER (WHERE status = 'completed'), 0)::numeric(18,2)::text AS revenue_today_usd
           FROM sales WHERE entity_id = $1 AND sold_at::date = CURRENT_DATE`,
          [store.id],
        )
        : await client.query("SELECT 0::int AS sales_today,'0'::text AS revenue_today_usd");
      const discountLimits = permissions["store.pos.configure"]
        ? await client.query(
          `SELECT r.id AS role_id, r.code, r.name, COALESCE(d.max_percent, 0)::text AS max_percent
           FROM roles r LEFT JOIN store_discount_limits d ON d.role_id = r.id
           ORDER BY r.name`,
        )
        : await client.query("SELECT NULL::uuid AS role_id, ''::text AS code, ''::text AS name, '0'::text AS max_percent WHERE false");
      const exhibitors = permissions["store.exhibitor.manage"] || permissions["store.report.read"]
        || permissions["store.exhibitor.validate"] || permissions["store.exhibitor.pay"]
        ? await client.query(
          `SELECT id,name,contact_name,email,phone,space_label,rent_amount::text,
                  rent_currency,rent_period,commission_pct::text,commission_basis,status
           FROM exhibitors ORDER BY name`,
        )
        : await client.query("SELECT NULL::uuid AS id,''::text AS name WHERE false");
      const roleLimits = permissions["store.pos.sell"] ? await client.query<{ max_percent: string }>(
        `SELECT COALESCE(MAX(d.max_percent), 0)::text AS max_percent
         FROM user_roles ur
         JOIN store_discount_limits d ON d.role_id = ur.role_id
         WHERE ur.user_id = $1 AND (ur.entity_id IS NULL OR ur.entity_id = $2)`,
        [actor.id, store.id],
      ) : { rows: [] };
      const cashSessions = permissions["store.pos.sell"] ? await client.query(
        `SELECT a.id AS account_id, a.name, a.currency, cs.id AS session_id, cs.status,
                cs.opening_count::text, cs.closing_count::text
         FROM accounts a
         LEFT JOIN cash_sessions cs ON cs.account_id = a.id AND cs.session_date = $2::date
         WHERE a.entity_id = $1 AND a.account_type = 'cash' AND a.is_active
         ORDER BY a.name`,
        [store.id, businessDate.today],
      ) : { rows: [] };
      const search = new URL(request.url).searchParams;
      if (search.get("format") === "csv") {
        if (!permissions["store.report.read"]) {
          return NextResponse.json({ error: "Permission denied." }, { status: 403 });
        }
        const content = [
          ["sku", "barcode", "name", "category", "quantity", "minimum_stock", "purchase_price", "sale_price", "currency", "status"].map(csvCell).join(","),
          ...products.rows.map((product) => [
            product.sku, product.barcode, product.name, product.category, product.quantity,
            product.min_stock, product.purchase_price, product.sale_price, product.price_currency, product.status,
          ].map(csvCell).join(",")),
        ].join("\r\n");
        return new Response(`\uFEFF${content}`, {
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": 'attachment; filename="mojo-store-products.csv"',
            "cache-control": "no-store",
          },
        });
      }

      return NextResponse.json({
        store,
        permissions,
        categories: categories.rows,
        products: products.rows,
        locations: locations.rows,
        suppliers: suppliers.rows,
        accounts: accounts.rows,
        customers: customers.rows,
        exchangeRateToHtg: exchangeRate.rows[0]?.rate ?? null,
        sales: sales.rows,
        metrics: metrics.rows[0],
        discountLimits: discountLimits.rows,
        exhibitors: exhibitors.rows,
        myMaxDiscountPercent: roleLimits.rows[0]?.max_percent ?? "0",
        cashSessions: cashSessions.rows,
        businessDate: businessDate.today,
      });
    });
  } catch (error) {
    console.error("Unable to load MOJO Store data.", error);
    return NextResponse.json({ error: "Unable to load MOJO Store data." }, { status: 500 });
  }
}
