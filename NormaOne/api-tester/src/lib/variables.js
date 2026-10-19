/**
 * Fills in {{name}} placeholders, the same way Postman does.
 *
 * The screens pass real values, so this mostly matters for the sample bodies that come from
 * the Postman collection and are shown in the technical details — a {{$timestamp}} in one of
 * those should read as a number, not as braces.
 */

/** Values made up on the spot. These are what keep a unique subdomain unique per send. */
function builtIns() {
  const now = new Date();
  return {
    $timestamp: String(Math.floor(now.getTime() / 1000)),
    $isoTimestamp: now.toISOString(),
    $randomInt: String(Math.floor(Math.random() * 1000)),
    $guid: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(now.getTime()),
  };
}

/**
 * Fills in every {{name}} in some text. Also returns what was put in, so the request details
 * panel can show which placeholder turned into which value.
 */
export function applyVariables(text, variables) {
  if (typeof text !== 'string' || !text.includes('{{')) {
    return { text, used: [] };
  }
  const generated = builtIns();
  const used = [];
  const filled = text.replace(/\{\{([^}\s]+)\}\}/g, (whole, name) => {
    if (name in generated) {
      used.push({ name, value: generated[name], kind: 'generated' });
      return generated[name];
    }
    if (variables && name in variables && variables[name] !== '') {
      used.push({ name, value: variables[name], kind: 'saved' });
      return variables[name];
    }
    // Leave an unknown placeholder alone rather than blanking it. A URL with a visible
    // {{schoolId}} in it tells you what went wrong; an empty gap does not.
    used.push({ name, value: null, kind: 'missing' });
    return whole;
  });
  return { text: filled, used };
}
