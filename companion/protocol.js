require("../extension/time-utils.js");
require("../extension/error-utils.js");
require("../extension/state-utils.js");
const { sanitizeState } = globalThis.__slaiState;
const { codedError } = globalThis.__slaiErrors;
const LIMIT = 256 * 1024;
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function validateStateEnvelope(input) {
  try {
    if (!input || Array.isArray(input) || Object.keys(input).sort().join() !== "schemaVersion,state" || input.schemaVersion !== 1 || input.state?.schemaVersion !== 4) throw new Error();
    const clean = sanitizeState(input.state);
    if (JSON.stringify(canonical(clean)) !== JSON.stringify(canonical(input.state))) throw new Error();
    return clean;
  } catch { throw codedError("INVALID_SCHEMA", { stage: "companion_request" }); }
}
module.exports = { LIMIT, validateStateEnvelope };
