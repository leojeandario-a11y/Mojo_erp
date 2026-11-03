import "server-only";
import type { PoolClient } from "pg";
import type { AuthUser } from "@/lib/auth";
import { hasEntityPermission } from "@/lib/permissions";
import {
  convertCents as convertMoneyCents,
  formatCents,
  formatQuantityThousandths,
  multiplyCentsByQuantity,
  parseCents,
  parseQuantityThousandths,
} from "@/lib/store-money.mjs";

export class StorePolicyError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function getStoreEntity(client: PoolClient) {
  const result = await client.query<{ id: string; code: string; name: string }>(
    "SELECT id, code, name FROM entities WHERE code = 'STORE' AND is_active",
  );
  if (!result.rowCount) throw new StorePolicyError("The MOJO Store entity is unavailable.", 409);
  return result.rows[0];
}

export async function canStorePermission(
  client: PoolClient,
  actor: AuthUser,
  permission: string,
  entityId: string,
) {
  if (!hasEntityPermission(actor, permission, entityId)) return false;
  const result = await client.query<{ allowed: boolean }>(
    "SELECT app_has_entity_permission($1, $2::uuid) AS allowed",
    [permission, entityId],
  );
  return result.rows[0]?.allowed === true;
}

export async function requireStorePermission(
  client: PoolClient,
  actor: AuthUser,
  permission: string,
  entityId: string,
) {
  if (!await canStorePermission(client, actor, permission, entityId)) {
    throw new StorePolicyError("Permission denied for MOJO Store.", 403);
  }
}

export async function nextStoreTransactionNumber(
  client: PoolClient,
  entityId: string,
  entityCode: string,
  date: string,
) {
  const year = Number(date.slice(0, 4));
  const result = await client.query<{ last_value: string }>(
    `INSERT INTO transaction_number_counters(entity_id, calendar_year, last_value)
     VALUES ($1, $2, 1)
     ON CONFLICT (entity_id, calendar_year)
     DO UPDATE SET last_value = transaction_number_counters.last_value + 1
     RETURNING last_value::text`,
    [entityId, year],
  );
  return `${entityCode}-${year}-${result.rows[0].last_value.padStart(6, "0")}`;
}

export async function nextStoreReceiptNumber(client: PoolClient, date: string) {
  const result = await client.query<{ last_value: string }>(
    `INSERT INTO store_receipt_counters(sale_date, last_value)
     VALUES ($1::date, 1)
     ON CONFLICT (sale_date)
     DO UPDATE SET last_value = store_receipt_counters.last_value + 1
     RETURNING last_value::text`,
    [date],
  );
  return `STORE-${date.replaceAll("-", "")}-${result.rows[0].last_value.padStart(6, "0")}`;
}

export function cents(value: string) {
  try {
    return parseCents(value);
  } catch (error) {
    if (error instanceof RangeError) throw new StorePolicyError("Invalid monetary amount.", 400);
    throw error;
  }
}

export function decimal(centsValue: bigint) {
  return formatCents(centsValue);
}

export function multiplyMoney(price: string, quantity: string) {
  try {
    return multiplyCentsByQuantity(price, quantity);
  } catch (error) {
    if (error instanceof RangeError) throw new StorePolicyError("Invalid price or quantity.", 400);
    throw error;
  }
}

export function quantityThousandths(quantity: string) {
  try {
    return parseQuantityThousandths(quantity);
  } catch (error) {
    if (error instanceof RangeError) throw new StorePolicyError("Invalid quantity.", 400);
    throw error;
  }
}

export function decimalQuantity(thousandths: bigint) {
  return formatQuantityThousandths(thousandths);
}

export function convertCurrencyCents(amount: bigint, sourceRate: string, targetRate: string) {
  try {
    return convertMoneyCents(amount, sourceRate, targetRate);
  } catch (error) {
    if (error instanceof RangeError) throw new StorePolicyError("Invalid exchange rate.", 409);
    throw error;
  }
}
