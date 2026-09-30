"use client";

import { useState } from "react";

/**
 * The signed-in person's Google photo, square and 0-radius like everything else
 * in the Blueprint system — or, when there is no photo or it will not load, a
 * square holding their initial.
 *
 * A plain `<img>`, not `next/image`: Google serves avatars from a handful of
 * `*.googleusercontent.com` hosts, and routing them through the optimizer would
 * mean a `remotePatterns` entry for a 28px picture. `referrerPolicy` is
 * `no-referrer` because Google's avatar hosts refuse some hotlinked requests
 * that carry one.
 *
 * Decorative (`alt=""`): the control it sits in already names the person.
 */
export function ProfileAvatar({
  image,
  initial,
  size = 28,
}: {
  image: string | null | undefined;
  initial: string;
  size?: number;
}) {
  // Remember *which* URL failed, so a new photo gets its own chance to load.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showPhoto = Boolean(image) && failedSrc !== image;

  if (showPhoto && image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- see the note above: no optimizer for a 28px third-party avatar.
      <img
        className="profile-avatar"
        src={image}
        alt=""
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        onError={() => setFailedSrc(image)}
      />
    );
  }

  return (
    <span
      className="profile-avatar profile-avatar-initial"
      style={{ width: size, height: size }}
      aria-hidden="true"
      data-testid="profile-avatar-initial"
    >
      {initial}
    </span>
  );
}
