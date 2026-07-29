/**
 * The browser side of sign-in. Everything here is exercised with a stubbed
 * `fetch` and a stubbed `window.location` — no network, no navigation
 * (Article 3).
 *
 * The behaviour worth protecting is the degradation: every failure resolves to
 * "nobody is signed in" rather than to an exception, because a visitor who is
 * not signed in must still get a working page.
 */
import {
  IDENTITY_ENDPOINT,
  SIGN_IN_ENDPOINT,
  SIGN_OUT_ENDPOINT,
  fetchIdentity,
  firstNameOf,
  isSignedIn,
  signOutAndReload,
  startGoogleSignIn,
} from "./sign-in-client";

const assign = vi.fn();
const reload = vi.fn();

function stubLocation() {
  vi.stubGlobal("location", {
    href: "http://localhost:3000/tools/form-4",
    assign,
    reload,
  });
}

function stubFetch(impl: (input: string, init?: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  assign.mockClear();
  reload.mockClear();
  stubLocation();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("firstNameOf", () => {
  it("takes the first word of a display name", () => {
    expect(firstNameOf("Ada Lovelace")).toBe("Ada");
  });

  it("tolerates padding and repeated spaces", () => {
    expect(firstNameOf("  Ada   Lovelace ")).toBe("Ada");
  });

  it("returns an empty string for a missing name", () => {
    expect(firstNameOf(null)).toBe("");
    expect(firstNameOf(undefined)).toBe("");
    expect(firstNameOf("   ")).toBe("");
  });
});

describe("isSignedIn", () => {
  it("is false for no identity and for the anonymous one", () => {
    expect(isSignedIn(null)).toBe(false);
    expect(isSignedIn({ role: "anonymous", name: null })).toBe(false);
  });

  it("is true for every signed-in role", () => {
    expect(isSignedIn({ role: "student", name: "Ada" })).toBe(true);
    expect(isSignedIn({ role: "staff", name: "Ada" })).toBe(true);
    expect(isSignedIn({ role: "admin", name: "Ada" })).toBe(true);
  });
});

describe("fetchIdentity", () => {
  it("reads role and name from the identity endpoint", async () => {
    const fetchMock = stubFetch(async () =>
      json({ role: "student", name: "Ada Lovelace" })
    );

    await expect(fetchIdentity()).resolves.toEqual({
      role: "student",
      name: "Ada Lovelace",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      IDENTITY_ENDPOINT,
      expect.objectContaining({ method: "GET", cache: "no-store" })
    );
  });

  it("keeps the anonymous answer, which is a normal answer", async () => {
    stubFetch(async () => json({ role: "anonymous", name: null }));
    await expect(fetchIdentity()).resolves.toEqual({
      role: "anonymous",
      name: null,
    });
  });

  it("resolves to null on a non-OK response instead of throwing", async () => {
    stubFetch(async () => json({ error: "Too many requests." }, 429));
    await expect(fetchIdentity()).resolves.toBeNull();
  });

  it("resolves to null when the request fails outright", async () => {
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(fetchIdentity()).resolves.toBeNull();
  });

  it("resolves to null when the body is not an identity", async () => {
    stubFetch(async () => json({ unexpected: true }));
    await expect(fetchIdentity()).resolves.toBeNull();
  });
});

describe("startGoogleSignIn", () => {
  it("asks Better Auth for the Google URL and goes there", async () => {
    const fetchMock = stubFetch(async () =>
      json({ url: "https://accounts.google.com/o/oauth2/auth?hd=cornell.edu" })
    );

    await expect(startGoogleSignIn("/tools/form-4")).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(SIGN_IN_ENDPOINT);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      provider: "google",
      callbackURL: "/tools/form-4",
    });
    expect(assign).toHaveBeenCalledWith(
      "https://accounts.google.com/o/oauth2/auth?hd=cornell.edu"
    );
  });

  it("comes back to the page the user was on, not to /", async () => {
    const fetchMock = stubFetch(async () => json({ url: "https://accounts.google.com/x" }));
    await startGoogleSignIn("/projects/42");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).callbackURL).toBe(
      "/projects/42"
    );
  });

  it("falls back to / when there is no path to return to", async () => {
    const fetchMock = stubFetch(async () => json({ url: "https://accounts.google.com/x" }));
    await startGoogleSignIn("");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).callbackURL).toBe("/");
  });

  it("reports failure and navigates nowhere when sign-in is unconfigured", async () => {
    stubFetch(async () => json({ error: "Sign-in is not configured." }, 503));
    await expect(startGoogleSignIn("/")).resolves.toBe(false);
    expect(assign).not.toHaveBeenCalled();
  });

  it("reports failure when the response carries no URL", async () => {
    stubFetch(async () => json({ redirect: true }));
    await expect(startGoogleSignIn("/")).resolves.toBe(false);
    expect(assign).not.toHaveBeenCalled();
  });

  it("reports failure rather than throwing when the request blows up", async () => {
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(startGoogleSignIn("/")).resolves.toBe(false);
  });
});

describe("signOutAndReload", () => {
  it("posts to the sign-out endpoint, then reloads", async () => {
    const fetchMock = stubFetch(async () => json({ success: true }));

    await signOutAndReload();

    expect(fetchMock).toHaveBeenCalledWith(
      SIGN_OUT_ENDPOINT,
      expect.objectContaining({ method: "POST" })
    );
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads even when the request fails, so the page shows the truth", async () => {
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });

    await signOutAndReload();

    expect(reload).toHaveBeenCalledTimes(1);
  });
});
