const u = require('node:util');
const orig = u.styleText;
if (orig) {
  u.styleText = (f, t) => (Array.isArray(f) ? f.reduce((s, x) => orig(x, s), t) : orig(f, t));
}
