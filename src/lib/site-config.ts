/**
 * Site-wide configuration for white-labeling.
 * Edit this file to customize the app for a different makerlab.
 */
export const siteConfig = {
  /** Display name shown in headers and titles */
  name: "MakerLab Tools",
  /** Institution or organization name */
  institution: "Cornell",
  /** Tagline shown on the home page */
  tagline:
    "Browse, search, and learn about equipment in the Cornell MakerLab.",
  /** Name for the AI chat assistant */
  chatAssistantName: "MakerLab Assistant",
  /** Audience description used in AI system prompts */
  audience: "Cornell students who may be beginners",
  /** Path to the logo image in /public */
  logo: "/makerlab-logo-blackonly.png",
  /** Brand colors — also update CSS variables in globals.css */
  colors: {
    primary: "#B31B1B",
    primaryDark: "#7E1416",
  },
};
