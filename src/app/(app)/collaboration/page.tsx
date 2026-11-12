import { CollaborationManager } from "@/components/collaboration-manager";
import { getSession, hasPermission } from "@/lib/auth";
import { getDirectorDepartmentCode, isCollaborationDirector } from "@/lib/collaboration-roles";

export default async function CollaborationPage() {
  const user = await getSession();
  if (!user) return null;
  return (
    <CollaborationManager
      actorId={user.id}
      locale={user.locale}
      canAnnounce={hasPermission(user, "collaboration.announcement.global")
        || hasPermission(user, "collaboration.announcement.department")}
      canAnnounceGlobal={hasPermission(user, "collaboration.announcement.global")}
      departmentCode={getDirectorDepartmentCode(user.roles)}
      canScheduleMeetings={hasPermission(user, "collaboration.meeting.schedule")
        && (isCollaborationDirector(user.roles) || user.roles.includes("dg"))}
      canCreateGroups={hasPermission(user, "collaboration.chat.group.create")
        && (isCollaborationDirector(user.roles) || user.roles.includes("dg"))}
      canReadDirectorsChat={hasPermission(user, "collaboration.chat.directors.read")
        && (isCollaborationDirector(user.roles) || user.roles.includes("dg"))}
    />
  );
}
