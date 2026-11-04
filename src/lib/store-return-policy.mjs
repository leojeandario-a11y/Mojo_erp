const DAY_MS = 24 * 60 * 60 * 1000;

function utcDay(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const timestamp = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date) return null;
  return timestamp;
}

export function isWithinStoreReturnWindow(soldDate, businessDate) {
  const sold = utcDay(soldDate);
  const business = utcDay(businessDate);
  if (sold === null || business === null) return false;
  const elapsedDays = (business - sold) / DAY_MS;
  return Number.isInteger(elapsedDays) && elapsedDays >= 0 && elapsedDays < 7;
}
