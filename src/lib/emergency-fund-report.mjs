/**
 * @param {"monthly" | "quarterly" | "annual"} period
 * @param {number} year
 * @param {number | undefined} index
 */
export function getFundReportDateRange(period, year, index) {
  if (!Number.isInteger(year) || year < 2000 || year > 9998) {
    throw new RangeError("Report year must be an integer from 2000 through 9998.");
  }
  if (period === "monthly" && (!Number.isInteger(index) || index < 1 || index > 12)) {
    throw new RangeError("A monthly report requires a month from 1 through 12.");
  }
  if (period === "quarterly" && (!Number.isInteger(index) || index < 1 || index > 4)) {
    throw new RangeError("A quarterly report requires a quarter from 1 through 4.");
  }
  if (period === "annual" && index !== undefined) {
    throw new RangeError("An annual report does not accept a period index.");
  }

  const selectedIndex = index ?? 1;
  const firstMonth = period === "monthly" ? selectedIndex - 1
    : period === "quarterly" ? (selectedIndex - 1) * 3 : 0;
  const monthCount = period === "monthly" ? 1 : period === "quarterly" ? 3 : 12;
  const start = new Date(Date.UTC(year, firstMonth, 1));
  const end = new Date(Date.UTC(year, firstMonth + monthCount, 1));
  const toExclusive = end.toISOString().slice(0, 10);
  return {
    from: start.toISOString().slice(0, 10),
    toExclusive,
    to: new Date(end.getTime() - 86400000).toISOString().slice(0, 10),
  };
}
