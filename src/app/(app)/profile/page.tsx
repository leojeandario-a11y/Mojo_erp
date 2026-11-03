import { ProfileForm } from "@/components/profile-form";
import { getSession } from "@/lib/auth";
import { translate } from "@/lib/i18n";

export default async function ProfilePage() {
  const user = await getSession();
  if (!user) return null;

  return (
    <div className="admin-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">{translate(user.locale, "workspace").toUpperCase()}</span>
          <h1>{translate(user.locale, "profile")}<span className="heading-period">.</span></h1>
          <p>{user.fullName} · {user.email}</p>
        </div>
      </div>
      <ProfileForm locale={user.locale} user={{
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        department: user.department,
        registrationBadgeId: user.registrationBadgeId,
        hasProfilePhoto: user.hasProfilePhoto,
        profilePhotoVersion: user.profilePhotoVersion,
      }} />
    </div>
  );
}
