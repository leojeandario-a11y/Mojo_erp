export function nextReportRun(frequency, now = new Date()) {
  const next = new Date(now);
  next.setUTCHours(8, 0, 0, 0);

  if (frequency === "daily") {
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    return next;
  }
  if (frequency === "weekly") {
    const daysUntilMonday = (8 - next.getUTCDay()) % 7 || 7;
    next.setUTCDate(next.getUTCDate() + daysUntilMonday);
    return next;
  }
  if (frequency === "monthly") {
    next.setUTCDate(1);
    if (next <= now) next.setUTCMonth(next.getUTCMonth() + 1);
    return next;
  }
  throw new RangeError("Unsupported report schedule frequency.");
}
