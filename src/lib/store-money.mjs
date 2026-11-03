const zero = BigInt("0");
const hundred = BigInt("100");
const thousand = BigInt("1000");

export function parseCents(value) {
  const match = /^(\d{1,14})(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new RangeError("Invalid monetary amount.");
  return BigInt(match[1]) * hundred + BigInt((match[2] ?? "").padEnd(2, "0"));
}

export function formatCents(centsValue) {
  const absolute = centsValue < zero ? -centsValue : centsValue;
  const value = `${absolute / hundred}.${String(absolute % hundred).padStart(2, "0")}`;
  return centsValue < zero ? `-${value}` : value;
}

export function parseQuantityThousandths(quantity) {
  const parts = /^(\d{1,9})(?:\.(\d{1,3}))?$/.exec(quantity);
  if (!parts) throw new RangeError("Invalid quantity.");
  return BigInt(parts[1]) * thousand + BigInt((parts[2] ?? "").padEnd(3, "0"));
}

export function formatQuantityThousandths(thousandths) {
  const sign = thousandths < zero ? "-" : "";
  const absolute = thousandths < zero ? -thousandths : thousandths;
  return `${sign}${absolute / thousand}.${String(absolute % thousand).padStart(3, "0")}`;
}

export function multiplyCentsByQuantity(price, quantity) {
  const product = parseCents(price) * parseQuantityThousandths(quantity);
  return (product + BigInt("500")) / thousand;
}

export function parseRateUnits(value) {
  const match = /^(\d+)(?:\.(\d{1,8}))?$/.exec(value);
  if (!match) throw new RangeError("Invalid exchange rate.");
  return BigInt(match[1]) * BigInt("100000000")
    + BigInt((match[2] ?? "").padEnd(8, "0"));
}

export function convertCents(amountCents, sourceRate, targetRate) {
  const source = parseRateUnits(sourceRate);
  const target = parseRateUnits(targetRate);
  if (target <= zero) throw new RangeError("Invalid exchange rate.");
  const numerator = amountCents * source;
  return (numerator + target / BigInt("2")) / target;
}
