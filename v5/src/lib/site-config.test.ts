// site-config reads process.env at MODULE LOAD, so to test overrides we must
// stubEnv → resetModules → dynamic import. See test/README.md "Env stubbing for
// module-load-time reads" and the design doc §2 constraint #4.

describe("site-config", () => {
  describe("defaults (env unset)", () => {
    it("uses documented defaults when no NEXT_PUBLIC_* / AUDIENCE vars are set", async () => {
      // Ensure none of the relevant vars leak in from the environment.
      vi.stubEnv("NEXT_PUBLIC_SITE_NAME", "");
      vi.stubEnv("NEXT_PUBLIC_INSTITUTION", "");
      vi.stubEnv("NEXT_PUBLIC_TAGLINE", "");
      vi.stubEnv("NEXT_PUBLIC_CHAT_ASSISTANT_NAME", "");
      vi.stubEnv("AUDIENCE", "");
      vi.stubEnv("NEXT_PUBLIC_LOGO", "");
      vi.stubEnv("NEXT_PUBLIC_COLOR_PRIMARY", "");
      vi.stubEnv("NEXT_PUBLIC_COLOR_PRIMARY_DARK", "");
      // `vi.stubEnv(name, "")` sets the var to "" rather than deleting it. The
      // source uses `??`, so we want genuinely-undefined values to exercise the
      // defaults. Delete them outright.
      delete process.env.NEXT_PUBLIC_SITE_NAME;
      delete process.env.NEXT_PUBLIC_INSTITUTION;
      delete process.env.NEXT_PUBLIC_TAGLINE;
      delete process.env.NEXT_PUBLIC_CHAT_ASSISTANT_NAME;
      delete process.env.AUDIENCE;
      delete process.env.NEXT_PUBLIC_LOGO;
      delete process.env.NEXT_PUBLIC_COLOR_PRIMARY;
      delete process.env.NEXT_PUBLIC_COLOR_PRIMARY_DARK;

      vi.resetModules();
      const { siteConfig } = await import("@/lib/site-config");

      expect(siteConfig.name).toBe("MakerLab Tools");
      expect(siteConfig.institution).toBe("Cornell Tech");
      expect(siteConfig.tagline).toBe(
        "Browse, search, and learn about makerspace equipment.",
      );
      expect(siteConfig.chatAssistantName).toBe("MakerLab Assistant");
      expect(siteConfig.audience).toBe("students who may be beginners");
      expect(siteConfig.logo).toBe("/makerlab-logo-transparent.png");
      expect(siteConfig.colors).toEqual({
        primary: "#ff6b35",
        primaryDark: "#cc4f1f",
      });
    });
  });

  describe("overrides (env set)", () => {
    it("flows every stubbed var through, including the nested colors object", async () => {
      vi.stubEnv("NEXT_PUBLIC_SITE_NAME", "Acme Lab");
      vi.stubEnv("NEXT_PUBLIC_INSTITUTION", "Acme University");
      vi.stubEnv("NEXT_PUBLIC_TAGLINE", "Make all the things.");
      vi.stubEnv("NEXT_PUBLIC_CHAT_ASSISTANT_NAME", "Acme Helper");
      vi.stubEnv("AUDIENCE", "expert machinists");
      vi.stubEnv("NEXT_PUBLIC_LOGO", "/acme-logo.svg");
      vi.stubEnv("NEXT_PUBLIC_COLOR_PRIMARY", "#123456");
      vi.stubEnv("NEXT_PUBLIC_COLOR_PRIMARY_DARK", "#0a1a2a");

      vi.resetModules();
      const { siteConfig } = await import("@/lib/site-config");

      expect(siteConfig.name).toBe("Acme Lab");
      expect(siteConfig.institution).toBe("Acme University");
      expect(siteConfig.tagline).toBe("Make all the things.");
      expect(siteConfig.chatAssistantName).toBe("Acme Helper");
      expect(siteConfig.audience).toBe("expert machinists");
      expect(siteConfig.logo).toBe("/acme-logo.svg");
      expect(siteConfig.colors).toEqual({
        primary: "#123456",
        primaryDark: "#0a1a2a",
      });
    });

    it("applies an individual override while leaving other fields at their defaults", async () => {
      delete process.env.NEXT_PUBLIC_INSTITUTION;
      vi.stubEnv("NEXT_PUBLIC_SITE_NAME", "Just The Name");

      vi.resetModules();
      const { siteConfig } = await import("@/lib/site-config");

      expect(siteConfig.name).toBe("Just The Name");
      expect(siteConfig.institution).toBe("Cornell Tech");
    });
  });
});
