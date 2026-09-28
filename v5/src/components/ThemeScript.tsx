// Inline script that reads the stored theme preference and applies the
// matching `data-theme` attribute to <html> before the first paint.
// Runs synchronously in <head> to avoid a flash of wrong colors.
//
// `/kiosk` is always dark (kiosk spec §3.1, §5.5: a screen that runs for days
// with no full-white areas), whatever the device has stored — and without
// storing anything, so the same browser's catalogue keeps its own choice.

const BOOTSTRAP = `(function(){try{var p=location.pathname;if(p==="/kiosk"||p.indexOf("/kiosk/")===0){document.documentElement.setAttribute("data-theme","dark");return}var t=localStorage.getItem("theme");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t)}}catch(e){}})()`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: BOOTSTRAP }} />;
}
