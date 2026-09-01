// SHIM (not upstream code).
//
// Upstream `src/i18n/i18n.js` boots i18next against the browser's language
// detector and the app's translation bundles. The only thing the vendored
// exporters ask of it is `i18n.t(x)` on the `Cardinality` constants, and every
// `switch` they feed the result into compares it against `i18n.t(...)` of the
// same constants — so an identity `t` keeps both sides of those comparisons on
// the raw English keys, which is exactly what a headless server wants.
const i18n = {
  t: (key) => key,
  language: "en",
  changeLanguage: () => Promise.resolve(),
};

export default i18n;
