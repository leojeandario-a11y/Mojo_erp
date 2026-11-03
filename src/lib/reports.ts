export const reportDefinitions = {
  finance: { permission: "finance.report.read", source: "transactions" },
  hr: { permission: "hr.report.read", source: "attendance_records" },
  business: { permission: "business.report.read", source: "opportunities" },
  marketing: { permission: "marketing.report.read", source: "marketing_campaigns" },
  operations: { permission: "operations.report.read", source: "projects" },
  store: { permission: "store.report.read", source: "sales" },
} as const;

export type ReportCategory = keyof typeof reportDefinitions;

export function isReportCategory(value: string): value is ReportCategory {
  return Object.hasOwn(reportDefinitions, value);
}
