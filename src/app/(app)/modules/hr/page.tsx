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
      <div className="page-heading">
        <div><span className="eyebrow">MOJOPIKTURES · RH</span><h1>Gestion des ressources humaines<span className="heading-period">.</span></h1></div>
      </div>
      <HrManager
        canManage={hasAnyPermission(user, ["hr.employee.manage", "hr.leave.approve"])}
        canManageAttendance={hasAnyPermission(user, ["hr.attendance.manage"])}
      />
    </div>
  );
}
