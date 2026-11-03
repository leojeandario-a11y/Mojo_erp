"use client";

import { useRouter } from "next/navigation";
import { useState, type ChangeEvent, type FormEvent } from "react";
import type { Locale } from "@/lib/auth";
import { translate } from "@/lib/i18n";
import { UserAvatar } from "@/components/user-avatar";

interface ProfileUser {
  id: string;
  email: string;
  fullName: string;
  department: string | null;
  registrationBadgeId: string | null;
  hasProfilePhoto: boolean;
  profilePhotoVersion: string;
}

export function ProfileForm({ locale, user }: { locale: Locale; user: ProfileUser }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [photoError, setPhotoError] = useState("");
  const [photoNotice, setPhotoNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [photoPending, setPhotoPending] = useState(false);
  const [hasPhoto, setHasPhoto] = useState(user.hasProfilePhoto);
  const [photoVersion, setPhotoVersion] = useState(user.profilePhotoVersion);
  const text = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  const [firstName = "", ...lastNameParts] = user.fullName.trim().split(/\s+/);
  const lastName = lastNameParts.join(" ");

  async function uploadPhoto(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setPhotoError("");
    setPhotoNotice("");
    if (!["image/jpeg", "image/png"].includes(file.type) || file.size > 2 * 1024 * 1024) {
      setPhotoError(file.size > 2 * 1024 * 1024 ? text("profilePhotoTooLarge") : text("profilePhotoInvalid"));
      input.value = "";
      return;
    }

    setPhotoPending(true);
    try {
      const formData = new FormData();
      formData.set("photo", file);
      const response = await fetch("/api/v1/profile/photo", { method: "PUT", body: formData });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? text("requestFailed"));
      const version = String(Date.now());
      setHasPhoto(true);
      setPhotoVersion(version);
      setPhotoNotice(text("profilePhotoSaved"));
      router.refresh();
    } catch (cause) {
      setPhotoError(cause instanceof Error ? cause.message : text("requestFailed"));
    } finally {
      setPhotoPending(false);
      input.value = "";
    }
  }

  async function removePhoto() {
    setPhotoError("");
    setPhotoNotice("");
    setPhotoPending(true);
    try {
      const response = await fetch("/api/v1/profile/photo", { method: "DELETE" });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? text("requestFailed"));
      setHasPhoto(false);
      setPhotoNotice(text("profilePhotoRemoved"));
      router.refresh();
    } catch (cause) {
      setPhotoError(cause instanceof Error ? cause.message : text("requestFailed"));
    } finally {
      setPhotoPending(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setPending(true);

    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const currentPassword = String(form.get("currentPassword") ?? "");
    const newPassword = String(form.get("newPassword") ?? "");
    if (newPassword !== form.get("confirmPassword")) {
      setError(text("passwordMismatch"));
      setPending(false);
      return;
    }

    try {
      const response = await fetch("/api/v1/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!response.ok) {
        setError(response.status === 400 ? text("changePasswordInvalid") : text("requestFailed"));
        return;
      }
      formElement.reset();
      setNotice(text("passwordChanged"));
    } catch {
      setError(text("requestFailed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="profile-overview-grid">
      <section className="panel profile-identity-panel">
        <div className="panel-heading">
          <div><span className="eyebrow">{text("profile").toUpperCase()}</span><h2>{text("userInformation")}</h2></div>
        </div>
        <div className="profile-identity-content">
          <div className="profile-photo-column">
            <UserAvatar fullName={user.fullName} hasPhoto={hasPhoto} photoVersion={photoVersion} size={92} className="profile-photo-avatar" />
            <label className={`button button-secondary profile-photo-upload ${photoPending ? "is-disabled" : ""}`}>
              <input
                type="file"
                className="sr-only"
                accept="image/jpeg,image/png"
                aria-label={text("uploadProfilePhoto")}
                disabled={photoPending}
                onChange={(event) => void uploadPhoto(event)}
              />
              {photoPending ? text("saving") : text("uploadProfilePhoto")}
            </label>
            {hasPhoto && <button className="profile-photo-remove" type="button" disabled={photoPending} onClick={() => void removePhoto()}>{text("removeProfilePhoto")}</button>}
            <small>{text("profilePhotoHelp")}</small>
          </div>
          <dl className="profile-details-grid">
            <div><dt>{text("firstName")}</dt><dd>{firstName || "—"}</dd></div>
            <div><dt>{text("lastName")}</dt><dd>{lastName || "—"}</dd></div>
            <div className="profile-detail-wide"><dt>{text("emailAddress")}</dt><dd>{user.email}</dd></div>
            <div><dt>{text("profileDepartment")}</dt><dd>{user.department ?? "—"}</dd></div>
            <div className="profile-detail-wide"><dt>{text(user.registrationBadgeId ? "badgeId" : "userId")}</dt><dd className="profile-user-id">{user.registrationBadgeId ?? user.id}</dd></div>
          </dl>
        </div>
        {photoNotice && <p className="success-message profile-feedback" role="status">{photoNotice}</p>}
        {photoError && <p className="form-error profile-feedback" role="alert">{photoError}</p>}
      </section>
      <section className="panel profile-settings-panel">
        <div className="panel-heading">
          <div><span className="eyebrow">{text("accountSecurity").toUpperCase()}</span><h2>{text("changePassword")}</h2></div>
        </div>
        <form className="stack-form profile-password-form" onSubmit={changePassword}>
          <label>{text("currentPassword")}<input name="currentPassword" type="password" autoComplete="current-password" required maxLength={128} /></label>
          <label>{text("newPassword")}<input name="newPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={128} /><small>{text("passwordMinimum")}</small></label>
          <label>{text("confirmPassword")}<input name="confirmPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={128} /></label>
          {notice && <p className="success-message" role="status">{notice}</p>}
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button button-primary" type="submit" disabled={pending}>
            {pending ? text("saving") : text("changePassword")}
          </button>
        </form>
      </section>
    </div>
  );
}
