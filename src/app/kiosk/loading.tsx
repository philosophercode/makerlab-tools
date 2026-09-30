/**
 * The kiosk's first paint while its snapshot loads (kiosk spec §3.1): dark
 * from the first frame — `ThemeScript` has already set the theme for this
 * path — with no light flash and nothing that could be mistaken for data.
 * English, because the page has not read `?lang=` yet.
 */
export default function KioskLoading() {
  return (
    <div data-kiosk="" data-theme="dark" className="ui fixed inset-0 flex items-center justify-center bg-background text-muted-foreground">
      <p role="status" className="font-mono text-[clamp(14px,2vmin,28px)] tracking-[0.12em] uppercase">
        Loading lab status…
      </p>
    </div>
  );
}
