import "server-only";
import { hashIp } from "../auth/identity";
import { rateLimitAsync, ROUTE_TIERS } from "../rate-limit";

/**
 * The limiter in front of the unsubscribe page and its POST (email
 * notifications spec §5.3): per hashed client address, read from the headers
 * the way `getClientIp` reads them, and checked **before** the token is
 * verified or anything is read. No cookie is read, so a signed-out reader and
 * a mail client's one-click POST are counted alike.
 */
export async function allowUnsubscribeRequest(headers: Headers): Promise<boolean> {
  const forwarded = headers.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0].trim() : headers.get("x-real-ip") || "unknown";
  const { allowed } = await rateLimitAsync(`notificationsUnsubscribe:ip:${await hashIp(ip)}`, ROUTE_TIERS.notificationsUnsubscribe);
  return allowed;
}
