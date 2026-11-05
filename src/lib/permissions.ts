export function hasPermission(user: { permissions: readonly string[] }, permission: string): boolean {
  return user.permissions.includes("*") || user.permissions.includes(permission);
}

export function isSuperAdmin(user: { roles: readonly string[] }): boolean {
  return user.roles.includes("super_admin");
}

export function hasEntityPermission(
  user: { permissions: readonly string[]; entityPermissions: Readonly<Record<string, readonly string[]>> },
  permission: string,
  entityId: string,
): boolean {
  return hasPermission(user, permission)
    || user.entityPermissions[entityId]?.includes(permission) === true;
}

export function hasAnyPermission(
  user: { permissions: readonly string[]; entityPermissions: Readonly<Record<string, readonly string[]>> },
  permissions: readonly string[],
): boolean {
  return permissions.some((permission) =>
    hasPermission(user, permission)
    || Object.values(user.entityPermissions).some((entityPermissions) =>
      entityPermissions.includes(permission),
    ),
  );
}
