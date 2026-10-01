import type { User } from "@swellfi/db";

export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Fields of a user that anyone may see. */
export function publicUser(u: User) {
  return {
    id: u.id,
    handle: u.handle,
    address: u.address,
    addressShort: shortAddress(u.address),
    avatarUrl: u.avatarUrl,
    bio: u.bio,
    xHandle: u.xVerified ? u.xHandle : null,
    xVerified: u.xVerified,
  };
}

export type PublicUser = ReturnType<typeof publicUser>;
