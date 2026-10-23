function isOctal(code: number): boolean {
  return code >= 48 && code <= 55;
}

function isHex(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102);
}

function codePoint(value: number, fallback: string): string {
  try {
    return String.fromCodePoint(value);
  } catch {
    return fallback;
  }
}

// ignoreBOM keeps a leading EF BB BF as U+FEFF instead of stripping it from each run.
const utf8 = new TextDecoder("utf-8", { ignoreBOM: true });

// Bash writes \xHH and \NNN as raw bytes, so a run of them is decoded as UTF-8.
// A byte outside a well-formed sequence has no character and becomes U+FFFD.
function decodeBytes(bytes: number[]): string {
  return utf8.decode(new Uint8Array(bytes));
}

// Reads a \xHH or \NNN escape at pos, which Bash treats as a single byte.
function readByteEscape(source: string, pos: number, limit: number) {
  if (source.charCodeAt(pos) !== 92 || pos + 2 > limit) return undefined;
  const escaped = source.charCodeAt(pos + 1);
  const digitsStart = pos + 2;
  let end = digitsStart;
  if (escaped === 120) {
    while (end < limit && end - digitsStart < 2 && isHex(source.charCodeAt(end))) end++;
    if (end === digitsStart) return undefined;
    return { value: Number.parseInt(source.slice(digitsStart, end), 16), end };
  }
  if (!isOctal(escaped)) return undefined;
  while (end < limit && end - digitsStart < 2 && isOctal(source.charCodeAt(end))) end++;
  return { value: Number.parseInt(source.slice(pos + 1, end), 8) & 0xff, end };
}

export function decodeAnsiCQuoted(source: string, start: number, limit: number) {
  let pos = start;
  let value = "";
  let bytes: number[] = [];
  // Bash ends the string at the first NUL an escape produces; scanning still runs to the closing quote.
  let nul = -1;

  while (pos < limit && source.charCodeAt(pos) !== 39) {
    const escapeStart = pos;
    const byte = readByteEscape(source, pos, limit);
    // ASCII bytes end a run like other text, so escapes such as \033 never pay for a decoder call.
    if (byte && byte.value >= 0x80) {
      bytes.push(byte.value);
      pos = byte.end;
      continue;
    }
    if (bytes.length > 0) {
      value += decodeBytes(bytes);
      bytes = [];
    }
    if (byte) {
      if (byte.value === 0 && nul === -1) nul = value.length;
      value += String.fromCharCode(byte.value);
      pos = byte.end;
      continue;
    }

    if (source.charCodeAt(pos) !== 92 || pos + 1 >= limit) {
      const runStart = pos;
      while (pos < limit) {
        const code = source.charCodeAt(pos);
        // A backslash at the end of input has nothing to escape; consume it as a
        // literal so the loop always advances.
        if (code === 39 || (code === 92 && pos + 1 < limit)) break;
        pos++;
      }
      value += source.slice(runStart, pos);
      continue;
    }

    pos++;
    const escaped = source[pos++];
    switch (escaped) {
      case "a":
        value += "\x07";
        break;
      case "b":
        value += "\b";
        break;
      case "e":
      case "E":
        value += "\x1B";
        break;
      case "f":
        value += "\f";
        break;
      case "n":
        value += "\n";
        break;
      case "r":
        value += "\r";
        break;
      case "t":
        value += "\t";
        break;
      case "v":
        value += "\v";
        break;
      case "\\":
        value += "\\";
        break;
      case "'":
        value += "'";
        break;
      case '"':
        value += '"';
        break;
      case "?":
        value += "?";
        break;
      case "\n":
        break;
      case "c": {
        // The closing quote (or end of input) is not an operand: \c stays literal.
        const code = pos < limit ? source.charCodeAt(pos) : 39;
        if (code === 39) {
          value += source.slice(escapeStart, pos);
          break;
        }
        pos++;
        if (code === 92) {
          // Bash writes a backslash operand as the pair \c\\; a lone backslash
          // still decodes and leaves the character it escaped as a literal.
          const pair = pos < limit && source.charCodeAt(pos) === 92;
          if (pair) pos++;
          value += "\x1c";
          if (!pair && pos < limit) {
            value += source[pos];
            pos++;
          }
          break;
        }
        const control = code === 63 ? 127 : code & 31;
        // Bash applies \c to the operand's first UTF-8 byte, which equals the code unit only for ASCII.
        if (control === 0 && code < 128 && nul === -1) nul = value.length;
        value += String.fromCharCode(control);
        break;
      }
      case "u":
      case "U": {
        const digitsStart = pos;
        const maxDigits = escaped === "u" ? 4 : 8;
        while (pos < limit && pos - digitsStart < maxDigits && isHex(source.charCodeAt(pos))) pos++;
        if (pos === digitsStart) {
          value += `\\${escaped}`;
          break;
        }
        const raw = source.slice(escapeStart, pos);
        const point = Number.parseInt(source.slice(digitsStart, pos), 16);
        if (point === 0 && nul === -1) nul = value.length;
        value += codePoint(point, raw);
        break;
      }
      default:
        value += `\\${escaped}`;
        break;
    }
  }
  if (bytes.length > 0) value += decodeBytes(bytes);
  if (nul !== -1) value = value.slice(0, nul);

  const closed = pos < limit;
  if (closed) pos++;
  return { value, end: pos, closed };
}
