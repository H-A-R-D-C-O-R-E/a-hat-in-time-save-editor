/**
 * Codec for A Hat in Time `.hat` save files.
 *
 * The format is Unreal-Engine "tagged property" serialization:
 *
 *   file      := header | propertyList
 *   header    := version:i32  slot:i32
 *   propertyList := property* terminator
 *   terminator:= "None"                      (an FString name)
 *   property  := name:FString type:FString size:i32 arrayIndex:i32 [tagExtras] payload[size]
 *
 * FString    := length:i32 bytes[length]     (length includes the trailing NUL)
 *
 * tagExtras / payload by type:
 *   BoolProperty   payload is empty (size == 0); one value byte follows arrayIndex
 *   StructProperty structType:FString is written as a tag extra, then payload[size]
 *                  is itself a propertyList (terminated by "None")
 *   ArrayProperty  payload[size] := count:i32 elements[count]
 *                  elements are struct propertyLists, optionally each prefixed with
 *                  an FString class path, or plain FString / int32 / byte values
 *   IntProperty    payload := int32
 *   FloatProperty  payload := float32
 *   StrProperty    payload := FString
 *   NameProperty   payload := FString
 *   ObjectProperty payload := FString, optionally followed by the referenced
 *                  object's own propertyList when it is serialized inline
 *   anything else  payload kept verbatim as hex
 *
 * An empty FString is written as a bare zero length with no NUL terminator; every
 * other FString length includes its trailing NUL.
 *
 * Everything is round-trip exact: decode() followed by encode() reproduces the
 * original bytes (verified by test/roundtrip.js against every sample save).
 */

export class FormatError extends Error {
  constructor(message, offset) {
    super(offset === undefined ? message : `${message} (at 0x${offset.toString(16)})`);
    this.name = 'FormatError';
    this.offset = offset;
  }
}

const KNOWN_TYPES = new Set([
  'IntProperty',
  'FloatProperty',
  'BoolProperty',
  'StrProperty',
  'NameProperty',
  'ObjectProperty',
  'StructProperty',
  'ArrayProperty',
]);

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

/* ------------------------------------------------------------------ bytes */

export function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new TypeError('expected binary input');
}

export function bytesToHex(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

export function hexToBytes(hex) {
  const clean = hex.replace(/\s+/g, '');
  if (clean.length % 2 !== 0) throw new FormatError('hex string has odd length');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(clean.substr(i * 2, 2), 16);
    if (Number.isNaN(byte)) throw new FormatError(`invalid hex at position ${i * 2}`);
    out[i] = byte;
  }
  return out;
}

/* ---------------------------------------------------------------- reader */

class Reader {
  constructor(bytes, base = 0) {
    this.data = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = 0;
    this.base = base; // absolute offset of bytes[0], for error messages
  }

  get remaining() { return this.data.length - this.pos; }
  at() { return this.base + this.pos; }

  need(n) {
    if (n < 0 || this.pos + n > this.data.length) {
      throw new FormatError(
        `unexpected end of data (wanted ${n} byte(s), ${this.remaining} left)`,
        this.at(),
      );
    }
  }

  u8() { this.need(1); return this.data[this.pos++]; }

  i32() {
    this.need(4);
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }

  u32() {
    this.need(4);
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  f32() {
    this.need(4);
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }

  bytes(n) {
    this.need(n);
    const out = this.data.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  /** Read a length-prefixed, NUL terminated UTF-8 string. */
  string() {
    const start = this.at();
    const n = this.i32();
    if (n < 0) throw new FormatError(`unsupported UTF-16 string (length ${n})`, start);
    if (n === 0) return '';
    const raw = this.bytes(n);
    let end = raw.length;
    if (raw[end - 1] === 0) end--;
    let text;
    try {
      text = decoder.decode(raw.subarray(0, end));
    } catch {
      throw new FormatError('string is not valid UTF-8', start);
    }
    return text;
  }
}

/* ---------------------------------------------------------------- writer */

class Writer {
  constructor(capacity = 1024) {
    this.buffer = new Uint8Array(capacity);
    this.length = 0;
  }

  #grow(extra) {
    if (this.length + extra <= this.buffer.length) return;
    let cap = this.buffer.length;
    while (cap < this.length + extra) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buffer.subarray(0, this.length));
    this.buffer = next;
  }

  u8(v) { this.#grow(1); this.buffer[this.length++] = v & 0xff; }

  i32(v) {
    this.#grow(4);
    new DataView(this.buffer.buffer).setInt32(this.length, v | 0, true);
    this.length += 4;
  }

  f32(v) {
    this.#grow(4);
    new DataView(this.buffer.buffer).setFloat32(this.length, v, true);
    this.length += 4;
  }

  raw(bytes) {
    this.#grow(bytes.length);
    this.buffer.set(bytes, this.length);
    this.length += bytes.length;
  }

  string(text) {
    if (text === '') {
      this.i32(0); // empty strings are written as a bare zero length, with no NUL
      return;
    }
    const body = encoder.encode(text);
    this.i32(body.length + 1); // length includes the NUL terminator
    this.raw(body);
    this.u8(0);
  }

  bytes() {
    return this.buffer.subarray(0, this.length);
  }

  done() {
    return this.buffer.slice(0, this.length);
  }
}

/* -------------------------------------------------------------- decoding */

function readStringStrict(reader, what) {
  const at = reader.at();
  const n = reader.i32();
  if (n <= 0) throw new FormatError(`malformed ${what} (length ${n})`, at);
  const raw = reader.bytes(n);
  if (raw[raw.length - 1] !== 0) throw new FormatError(`${what} is not NUL terminated`, at);
  try {
    return decoder.decode(raw.subarray(0, raw.length - 1));
  } catch {
    throw new FormatError(`${what} is not valid UTF-8`, at);
  }
}

/**
 * Read one propertyList. Stops at the "None" terminator.
 * `validate` adds the extra checks used when guessing array element boundaries
 * (where there is no `size` field to anchor the parse).
 */
function readPropertyList(reader, validate = false) {
  const properties = [];
  for (;;) {
    const nameAt = reader.at();
    const name = reader.string();
    if (name === 'None') return properties;

    if (validate) {
      if (name.length === 0 || name.length > 512 || /[\x00-\x1f\x7f]/.test(name)) {
        throw new FormatError(`implausible property name ${JSON.stringify(name)}`, nameAt);
      }
    }

    const typeAt = reader.at();
    const type = reader.string();
    if (validate && !KNOWN_TYPES.has(type)) {
      throw new FormatError(`implausible property type ${JSON.stringify(type)}`, typeAt);
    }

    const sizeAt = reader.at();
    const size = reader.i32();
    if (size < 0) throw new FormatError(`negative payload size ${size}`, sizeAt);
    const arrayIndex = reader.i32();
    if (arrayIndex < 0) throw new FormatError(`negative array index ${arrayIndex}`, sizeAt);

    properties.push({ name, type, arrayIndex, ...readPayload(reader, type, size, validate) });
  }
}

/** Read the type specific tag extras + payload. Returns extra fields for the property. */
function readPayload(reader, type, size, validate) {
  switch (type) {
    case 'BoolProperty': {
      if (size !== 0) throw new FormatError(`BoolProperty with size ${size}, expected 0`, reader.at());
      return { value: reader.u8() !== 0 };
    }

    case 'StructProperty': {
      const structType = readStringStrict(reader, 'struct type name');
      const payload = reader.bytes(size);
      const sub = new Reader(payload, reader.at() - size);
      try {
        const value = readPropertyList(sub, validate);
        if (sub.remaining !== 0) throw new FormatError('struct payload not fully consumed');
        return { structType, value };
      } catch (err) {
        if (err instanceof FormatError && err.offset === undefined) throw err;
        return { structType, raw: bytesToHex(payload) };
      }
    }

    case 'ArrayProperty': {
      const payload = reader.bytes(size);
      return decodeArray(payload, reader.at() - size);
    }

    case 'IntProperty':
      return readScalar(reader, size, 4, (sub) => sub.i32());

    case 'FloatProperty':
      return readScalar(reader, size, 4, (sub) => sub.f32());

    case 'StrProperty':
    case 'NameProperty':
      return readScalar(reader, size, null, (sub) => sub.string());

    case 'ObjectProperty':
      return readObject(reader, size);

    default:
      return { raw: bytesToHex(reader.bytes(size)) };
  }
}

function readScalar(reader, size, expected, fn) {
  const at = reader.at();
  const payload = reader.bytes(size);
  if (expected !== null && size !== expected) {
    return { raw: bytesToHex(payload) };
  }
  const sub = new Reader(payload, at);
  try {
    const value = fn(sub);
    if (sub.remaining !== 0) throw new FormatError('payload not fully consumed');
    return { value };
  } catch {
    return { raw: bytesToHex(payload) };
  }
}

/**
 * An object reference is normally just a path string. When the referenced object
 * is serialized inline (equipped loadout items do this) the path is followed by
 * that object's own property list.
 */
function readObject(reader, size) {
  const at = reader.at();
  const payload = reader.bytes(size);
  const sub = new Reader(payload, at);
  try {
    const value = sub.string();
    if (sub.remaining === 0) return { value };
    const properties = readPropertyList(sub);
    if (sub.remaining !== 0) throw new FormatError('object payload not fully consumed');
    return { value, properties };
  } catch {
    return { raw: bytesToHex(payload) };
  }
}

function i32At(bytes, offset) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getInt32(0, true);
}

function decodeArray(payload, base) {
  if (payload.length < 4) return { elementType: 'raw', raw: bytesToHex(payload) };

  const count = i32At(payload, 0);
  const inner = payload.length - 4;
  if (count < 0 || inner < 0) return { elementType: 'raw', raw: bytesToHex(payload) };
  if (count === 0 && inner === 0) return { elementType: 'empty', value: [] };

  for (const prefixed of [false, true]) {
    const elements = tryStructElements(payload, count, prefixed, base);
    if (elements) return { elementType: 'struct', value: elements };
  }

  const strings = tryStringElements(payload, count, base);
  if (strings) return { elementType: 'string', value: strings };

  if (inner === count * 4) {
    const value = [];
    for (let i = 0; i < count; i++) value.push(i32At(payload, 4 + i * 4));
    return { elementType: 'int32', value };
  }

  if (inner === count) {
    return { elementType: 'byte', value: Array.from(payload.subarray(4)) };
  }

  return { elementType: 'raw', raw: bytesToHex(payload) };
}

function tryStructElements(payload, count, prefixed, base) {
  const reader = new Reader(payload.subarray(4), base + 4);
  const elements = [];
  try {
    for (let i = 0; i < count; i++) {
      const element = {};
      if (prefixed) {
        const classPath = reader.string();
        if (classPath.length === 0 || classPath.length > 512 || /[\x00-\x1f\x7f]/.test(classPath)) {
          throw new FormatError('implausible class path');
        }
        element.class = classPath;
      }
      element.properties = readPropertyList(reader, true);
      elements.push(element);
    }
    if (reader.remaining !== 0) return null;
    return elements;
  } catch {
    return null;
  }
}

function tryStringElements(payload, count, base) {
  const reader = new Reader(payload.subarray(4), base + 4);
  const values = [];
  try {
    for (let i = 0; i < count; i++) {
      const value = reader.string();
      if (value.length > 4096) return null;
      values.push(value);
    }
    if (reader.remaining !== 0) return null;
    return values;
  } catch {
    return null;
  }
}

export function decode(input) {
  const bytes = toBytes(input);
  const reader = new Reader(bytes);
  const version = reader.i32();
  const slot = reader.i32();
  const properties = readPropertyList(reader);
  if (reader.remaining !== 0) {
    throw new FormatError(`${reader.remaining} trailing byte(s) after the property list`, reader.at());
  }
  return { version, slot, properties };
}

/* -------------------------------------------------------------- encoding */

function writePropertyList(writer, properties) {
  for (const property of properties) {
    if (property === null || typeof property !== 'object') {
      throw new FormatError('each property must be an object');
    }
    const { name, type, arrayIndex = 0 } = property;
    if (typeof name !== 'string' || typeof type !== 'string') {
      throw new FormatError('property "name" and "type" must be strings');
    }

    writer.string(name);
    writer.string(type);

    if (type === 'BoolProperty') {
      if (property.raw !== undefined) throw new FormatError(`BoolProperty "${name}" cannot carry raw data`);
      writer.i32(0);
      writer.i32(arrayIndex);
      writer.u8(property.value ? 1 : 0);
      continue;
    }

    const body = new Writer();
    if (type === 'StructProperty') {
      if (typeof property.structType !== 'string') {
        throw new FormatError(`StructProperty "${name}" is missing "structType"`);
      }
      if (property.raw !== undefined) {
        body.raw(hexToBytes(property.raw));
      } else {
        writePropertyList(body, requireArray(property.value, `"${name}" value`));
      }
      writer.i32(body.length);
      writer.i32(arrayIndex);
      writer.string(property.structType);
      writer.raw(body.bytes());
      continue;
    }

    if (type === 'ArrayProperty') {
      writeArray(body, property, name);
      writer.i32(body.length);
      writer.i32(arrayIndex);
      writer.raw(body.bytes());
      continue;
    }

    if (property.raw !== undefined) {
      body.raw(hexToBytes(property.raw));
    } else if (type === 'ObjectProperty') {
      writeObject(body, property, name);
    } else {
      writeScalar(body, type, property.value, name);
    }
    writer.i32(body.length);
    writer.i32(arrayIndex);
    writer.raw(body.bytes());
  }
  writer.string('None');
}

function writeScalar(writer, type, value, name) {
  switch (type) {
    case 'IntProperty':
      writer.i32(needInt(value, name));
      break;
    case 'FloatProperty':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new FormatError(`FloatProperty "${name}" needs a finite number`);
      }
      writer.f32(value);
      break;
    case 'StrProperty':
    case 'NameProperty':
      if (typeof value !== 'string') throw new FormatError(`${type} "${name}" needs a string value`);
      writer.string(value);
      break;
    default:
      throw new FormatError(`unsupported property type "${type}" (property "${name}")`);
  }
}

function writeObject(writer, property, name) {
  if (typeof property.value !== 'string') {
    throw new FormatError(`ObjectProperty "${name}" needs a string value`);
  }
  writer.string(property.value);
  if (property.properties !== undefined) {
    writePropertyList(writer, requireArray(property.properties, `ObjectProperty "${name}" properties`));
  }
}

function needInt(value, name) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff) {
    throw new FormatError(`IntProperty "${name}" needs a signed 32-bit integer`);
  }
  return value | 0;
}

function writeArray(writer, property, name) {
  const kind = property.elementType;
  const elements = property.value;

  if (kind === 'raw') {
    if (typeof property.raw !== 'string') throw new FormatError(`ArrayProperty "${name}" is missing "raw"`);
    writer.raw(hexToBytes(property.raw));
    return;
  }

  if (!Array.isArray(elements)) throw new FormatError(`ArrayProperty "${name}" needs a "value" array`);
  writer.i32(elements.length);

  switch (kind) {
    case 'empty':
      if (elements.length !== 0) throw new FormatError(`empty ArrayProperty "${name}" cannot hold elements`);
      break;
    case 'struct':
      for (const element of elements) {
        if (element === null || typeof element !== 'object') {
          throw new FormatError(`struct element of "${name}" must be an object with "properties"`);
        }
        if (element.class !== undefined && element.class !== null) {
          if (typeof element.class !== 'string') {
            throw new FormatError(`struct element "class" of "${name}" must be a string`);
          }
          writer.string(element.class);
        }
        const props = requireArray(element.properties, `struct element of "${name}"`);
        writePropertyList(writer, props);
      }
      break;
    case 'string':
      for (const value of elements) {
        if (typeof value !== 'string') throw new FormatError(`ArrayProperty "${name}" needs string elements`);
        writer.string(value);
      }
      break;
    case 'int32':
      for (const value of elements) writer.i32(needInt(value, name));
      break;
    case 'byte':
      for (const value of elements) {
        if (!Number.isInteger(value) || value < 0 || value > 255) {
          throw new FormatError(`ArrayProperty "${name}" needs byte elements (0-255)`);
        }
        writer.u8(value);
      }
      break;
    default:
      throw new FormatError(`ArrayProperty "${name}" has unknown elementType "${kind}"`);
  }
}

function requireArray(value, what) {
  if (!Array.isArray(value)) throw new FormatError(`${what} must be an array`);
  return value;
}

export function encode(document) {
  if (document === null || typeof document !== 'object') {
    throw new FormatError('expected a save document object');
  }
  const writer = new Writer(1 << 16);
  writer.i32(document.version ?? 1);
  writer.i32(document.slot ?? -1);
  writePropertyList(writer, requireArray(document.properties, 'document "properties"'));
  return writer.done();
}
