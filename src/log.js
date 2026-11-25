const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, text) => (color ? `\x1b[${code}m${text}\x1b[0m` : text);
const LEVELS = {
  info: paint('36', '[INFO] '),
  warn: paint('33', '[WARN] '),
  error: paint('31', '[ERROR]'),
};

const time = () => new Date().toTimeString().slice(0, 8);
const line = (level, tag, parts) => `${paint('90', time())} ${LEVELS[level]} ${tag.padEnd(6)} ${parts.join(' ')}`;

export function info(tag, ...parts) {
  console.log(line('info', tag, parts));
}

export function warn(tag, ...parts) {
  console.warn(line('warn', tag, parts));
}

export function error(tag, ...parts) {
  console.error(line('error', tag, parts));
}

export const log = info;

export function short(err) {
  if (err?.short) return err.short;
  const msg = String(err?.message ?? err ?? 'unknown error').replace(/\*\*/g, '');
  return msg.split(/(?<=[.!?])\s/)[0].slice(0, 120).toLowerCase();
}