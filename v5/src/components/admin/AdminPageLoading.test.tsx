import { render, screen } from "../../../test/utils/render";
import enMessages from "../../../messages/en.json";
import { AdminPageLoading } from "./AdminPageLoading";

describe("AdminPageLoading", () => {
  it("is the one loading line, in words", () => {
    render(<AdminPageLoading />);
    expect(screen.getByText(enMessages.admin.loading)).toBeInTheDocument();
    expect(document.querySelector('[data-slot="empty-state"]')).not.toBeNull();
  });
});
