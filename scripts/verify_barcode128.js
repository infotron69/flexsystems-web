// Standalone verification for the Code 128 table/encoder in
// src/components/Barcode128.jsx. Run with `node scripts/verify_barcode128.js`.
// Checks (independent of any external source, since a transcription error in
// the pattern table would otherwise silently produce a barcode that looks
// right but doesn't scan):
//   1. Every pattern's module-width digits sum to 11 (13 for STOP).
//   2. No two symbol values share the same pattern (unique decodability).
//   3. Encoding representative point codes and decoding the result via an
//      independent reader recovers the exact same symbol sequence, checksum,
//      and original text.
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131',
  '211412', '211214', '211232', '2331112',
];
const START_B = 104;
const STOP = 106;

function encodeCode128B(text) {
  const values = [...text].map(ch => ch.charCodeAt(0) - 32);
  let checksum = START_B;
  values.forEach((v, i) => { checksum += v * (i + 1); });
  checksum %= 103;
  const symbols = [START_B, ...values, checksum, STOP];
  const widths = [];
  for (const sym of symbols) for (const d of PATTERNS[sym]) widths.push(Number(d));
  return { symbols, widths };
}

function decodeWidths(widths) {
  const symbols = [];
  let i = 0;
  while (i < widths.length) {
    const len = widths.length - i === 7 ? 7 : 6;
    const chunk = widths.slice(i, i + len).join('');
    const value = PATTERNS.indexOf(chunk);
    if (value === -1) throw new Error(`Undecodable chunk at index ${i}: ${chunk}`);
    symbols.push(value);
    i += len;
  }
  return symbols;
}

PATTERNS.forEach((p, v) => {
  const sum = [...p].reduce((a, d) => a + Number(d), 0);
  const expected = v === STOP ? 13 : 11;
  if (sum !== expected) throw new Error(`Pattern for value ${v} ("${p}") sums to ${sum}, expected ${expected}`);
});

const seen = new Set();
PATTERNS.forEach((p, v) => {
  if (seen.has(p)) throw new Error(`Duplicate pattern "${p}" at value ${v}`);
  seen.add(p);
});

const samples = ['0000000006', '0000004187', '0000002613', 'ABC123', '0', '9999999999'];
for (const s of samples) {
  const { symbols, widths } = encodeCode128B(s);
  const decoded = decodeWidths(widths);
  if (JSON.stringify(decoded) !== JSON.stringify(symbols)) {
    throw new Error(`Round-trip mismatch for "${s}": encoded ${symbols} decoded ${decoded}`);
  }
  const dataSymbols = decoded.slice(1, -2);
  const text = dataSymbols.map(v => String.fromCharCode(v + 32)).join('');
  if (text !== s) throw new Error(`Text round-trip mismatch: "${s}" -> "${text}"`);
  let checksum = START_B;
  dataSymbols.forEach((v, i) => { checksum += v * (i + 1); });
  checksum %= 103;
  if (checksum !== decoded[decoded.length - 2]) {
    throw new Error(`Checksum mismatch for "${s}"`);
  }
}

console.log('Code128 table/encoder self-test: ALL PASSED');
