import { redirect } from "next/navigation";
import { HrManager } from "@/components/hr-manager";
import { getSession } from "@/lib/auth";
import { hasAnyPermission } from "@/lib/permissions";

export default async function HrPage() {
  const user = await getSession();
  if (!user) redirect("/login");
  if (!hasAnyPermission(user, [
    "hr.employee.read", "hr.employee.manage", "hr.leave.request",
    "hr.leave.approve", "hr.attendance.manage", "hr.report.read",
  ])) redirect("/forbidden");
  return (
    <div className="admin-page">
      <HrManager
        canManage={hasAnyPermission(user, ["hr.employee.manage", "hr.leave.approve"])}
        canManageAttendance={hasAnyPermission(user, ["hr.attendance.manage"])}
      />
    </div>
  );
}
