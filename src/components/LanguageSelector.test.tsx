import { render, screen, userEvent } from "../../test/utils/render";
import { LanguageSelector } from "./LanguageSelector";
import { LOCALES } from "../i18n/config";

// The component calls the `changeLocale` server action and then `router.refresh()`.
const changeLocale = vi.fn<(locale: string) => Promise<void>>();
const refresh = vi.fn();

vi.mock("@/i18n/actions", () => ({
  changeLocale: (locale: string) => changeLocale(locale),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

describe("LanguageSelector", () => {
  beforeEach(() => {
    changeLocale.mockClear();
    refresh.mockClear();
  });

  it("renders a select with all 12 locale options using their endonym labels", () => {
    render(<LanguageSelector />);

    const select = screen.getByRole("combobox", { name: "Select language" });
    expect(select).toBeInTheDocument();

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(LOCALES.length);
    expect(LOCALES).toHaveLength(12);

    for (const locale of LOCALES) {
      const option = screen.getByRole("option", { name: locale.label });
      expect(option).toHaveValue(locale.code);
    }
  });

  it("reflects the active locale as the selected value", () => {
    render(<LanguageSelector />, { locale: "fr" });
    const select = screen.getByRole("combobox", { name: "Select language" });
    expect(select).toHaveValue("fr");
  });

  it("calls changeLocale with the chosen code and refreshes the router", async () => {
    const user = userEvent.setup();
    render(<LanguageSelector />); // active locale defaults to "en"

    const select = screen.getByRole("combobox", { name: "Select language" });
    await user.selectOptions(select, "es");

    expect(changeLocale).toHaveBeenCalledTimes(1);
    expect(changeLocale).toHaveBeenCalledWith("es");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("handles selecting a non-Latin locale code", async () => {
    const user = userEvent.setup();
    render(<LanguageSelector />);

    const select = screen.getByRole("combobox", { name: "Select language" });
    await user.selectOptions(select, "zh-CN");

    expect(changeLocale).toHaveBeenCalledWith("zh-CN");
  });

  it("does not call the action when re-selecting the already-active locale", async () => {
    const user = userEvent.setup();
    render(<LanguageSelector />, { locale: "ko" });

    const select = screen.getByRole("combobox", { name: "Select language" });
    await user.selectOptions(select, "ko");

    expect(changeLocale).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});
