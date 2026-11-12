const directorDepartmentByRole = {
  daf: "DAF",
  drh: "DRH",
  affaires: "AFF",
  marketing: "MKT",
  operations: "OPS",
  stock_manager: "STORE",
} as const;

export type CollaborationDepartmentCode =
  (typeof directorDepartmentByRole)[keyof typeof directorDepartmentByRole];

export function getDirectorDepartmentCode(
  roles: readonly string[],
): CollaborationDepartmentCode | null {
  return Object.entries(directorDepartmentByRole).find(([role]) => roles.includes(role))?.[1] ?? null;
}

export function isCollaborationDirector(roles: readonly string[]): boolean {
  return roles.some((role) => role in directorDepartmentByRole);
}
