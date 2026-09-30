// Inline script that reads the `NEXT_LOCALE` cookie and applies the matching
// `lang` and `dir` attributes to <html> before the first paint.
//
// The root <html> shell is rendered statically (Cache Components), so it ships
// with a default `lang="en" dir="ltr"`. This script corrects those attributes
// synchronously from the cookie so screen readers and RTL layout (Arabic,
// Hebrew) are right on first paint. The streamed page content is already
// localized server-side via next-intl's request config.

const RTL_LOCALES = ["ar", "he"];

const BOOTSTRAP = `(function(){try{var m=document.cookie.match(/(?:^|; )NEXT_LOCALE=([^;]+)/);if(!m)return;var l=decodeURIComponent(m[1]);if(!l)return;var rtl=${JSON.stringify(
  RTL_LOCALES
)};document.documentElement.setAttribute("lang",l);document.documentElement.setAttribute("dir",rtl.indexOf(l)>-1?"rtl":"ltr");}catch(e){}})()`;

export function LocaleHtmlScript() {
  return <script dangerouslySetInnerHTML={{ __html: BOOTSTRAP }} />;
}
