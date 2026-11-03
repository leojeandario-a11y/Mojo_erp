"use client";

import Image from "next/image";
import { useState } from "react";

interface UserAvatarProps {
  fullName: string;
  hasPhoto: boolean;
  photoVersion: string;
  size?: number;
  className?: string;
}

export function UserAvatar({
  fullName,
  hasPhoto,
  photoVersion,
  size = 32,
  className = "",
}: UserAvatarProps) {
  const initials = fullName.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const source = `/api/v1/profile/photo?v=${encodeURIComponent(photoVersion)}`;
  const [failedSource, setFailedSource] = useState("");
  const imageAvailable = hasPhoto && failedSource !== source;

  return (
    <span
      className={`user-avatar ${className}`.trim()}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {imageAvailable && (
        <Image
          src={source}
          alt=""
          fill
          sizes={`${size}px`}
          unoptimized
          onError={() => setFailedSource(source)}
        />
      )}
      {!imageAvailable && <span>{initials}</span>}
    </span>
  );
}
