import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import SafetyBadges from "@/components/SafetyBadges";

describe("SafetyBadges", () => {
  it("renders a badge for each required PPE item", () => {
    render(
      <SafetyBadges
        ppe_required={["Safety Glasses", "Gloves", "Ear Protection"]}
        training_required={false}
        authorized_only={false}
      />
    );
    expect(screen.getByText("Safety Glasses")).toBeInTheDocument();
    expect(screen.getByText("Gloves")).toBeInTheDocument();
    expect(screen.getByText("Ear Protection")).toBeInTheDocument();
  });

  it("renders Training Required badge when training_required is true", () => {
    render(
      <SafetyBadges
        ppe_required={[]}
        training_required={true}
        authorized_only={false}
      />
    );
    expect(screen.getByText("Training Required")).toBeInTheDocument();
  });

  it("renders Authorization Required badge when authorized_only is true", () => {
    render(
      <SafetyBadges
        ppe_required={[]}
        training_required={false}
        authorized_only={true}
      />
    );
    expect(screen.getByText("Authorization Required")).toBeInTheDocument();
  });

  it("does not render Training Required badge when training_required is false", () => {
    render(
      <SafetyBadges
        ppe_required={["Gloves"]}
        training_required={false}
        authorized_only={false}
      />
    );
    expect(screen.queryByText("Training Required")).not.toBeInTheDocument();
  });

  it("does not render Authorization Required badge when authorized_only is false", () => {
    render(
      <SafetyBadges
        ppe_required={["Gloves"]}
        training_required={false}
        authorized_only={false}
      />
    );
    expect(screen.queryByText("Authorization Required")).not.toBeInTheDocument();
  });

  it("renders nothing when no safety requirements exist", () => {
    const { container } = render(
      <SafetyBadges
        ppe_required={[]}
        training_required={false}
        authorized_only={false}
      />
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders all badge types together when all requirements apply", () => {
    render(
      <SafetyBadges
        ppe_required={["Safety Glasses"]}
        training_required={true}
        authorized_only={true}
      />
    );
    expect(screen.getByText("Authorization Required")).toBeInTheDocument();
    expect(screen.getByText("Training Required")).toBeInTheDocument();
    expect(screen.getByText("Safety Glasses")).toBeInTheDocument();
  });

  it("renders authorization badge before training badge (priority order)", () => {
    const { container } = render(
      <SafetyBadges
        ppe_required={[]}
        training_required={true}
        authorized_only={true}
      />
    );
    const badges = container.querySelectorAll("span");
    expect(badges[0]).toHaveTextContent("Authorization Required");
    expect(badges[1]).toHaveTextContent("Training Required");
  });
});
