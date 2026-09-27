// Inline script that reads the stored theme preference and applies the
// matching `data-theme` attribute to <html> before the first paint.
// Runs synchronously in <head> to avoid a flash of wrong colors.

const BOOTSTRAP = `(function(){try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t)}}catch(e){}})()`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: BOOTSTRAP }} />;
}
