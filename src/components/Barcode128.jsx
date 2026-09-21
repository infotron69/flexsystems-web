// Code 128 (Subset B) barcode renderer.
//
// PATTERNS[v] is the module-width sequence for symbol value v (0-106): six digits
// (seven for the STOP symbol), each 1-4, giving alternating bar/space widths
// starting with a bar. Values 0-102 and the START symbols (103/104/105) sum to
// 11 modules; STOP (106) has 7 elements summing to 13 (includes the termination
// bar). This table and the encoder below are self-verified — every pattern's
// module-sum is checked, no two symbol values share a pattern, and the encoder's
// output round-trips through an independent decoder back to the original text
// for representative point codes (see scripts/verify_barcode128.js).
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
  '211412', // 103 START A
  '211214', // 104 START B
  '211232', // 105 START C
  '2331112', // 106 STOP
];
const START_B = 104;
const STOP = 106;

export function encodeCode128B(text) {
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code > 126) throw new Error(`Unsupported character for Code128B: ${JSON.stringify(ch)}`);
  }
  const values = [...text].map(ch => ch.charCodeAt(0) - 32);
  let checksum = START_B;
  values.forEach((v, i) => { checksum += v * (i + 1); });
  checksum %= 103;
  const symbols = [START_B, ...values, checksum, STOP];
  const widths = [];
  for (const sym of symbols) {
    for (const d of PATTERNS[sym]) widths.push(Number(d));
  }
  return widths;
}

// Renders `value` as a Code 128 barcode, with the human-readable text beneath it
// (standard barcode label convention). `value` must be printable ASCII (32-126) —
// point codes are digits, which are always valid.
export default function Barcode128({ value, moduleWidth = 2, height = 36, quietZone = 10, showText = true }) {
  if (!value) return null;
  let widths;
  try {
    widths = encodeCode128B(String(value));
  } catch {
    return <span style={{ fontSize: 11, color: '#b91c1c' }}>Unsupported barcode value</span>;
  }
  const totalModules = widths.reduce((a, w) => a + w, 0);
  const svgWidth = (totalModules + quietZone * 2) * moduleWidth;

  let x = quietZone * moduleWidth;
  const bars = [];
  widths.forEach((w, i) => {
    const isBar = i % 2 === 0; // patterns always start on a bar
    const barWidth = w * moduleWidth;
    if (isBar) {
      bars.push(<rect key={i} x={x} y={0} width={barWidth} height={height} fill="#000" />);
    }
    x += barWidth;
  });

  return (
    <span style={{ display: 'inline-block', textAlign: 'center' }}>
      <svg width={svgWidth} height={height} viewBox={`0 0 ${svgWidth} ${height}`} role="img" aria-label={`Barcode ${value}`}>
        {bars}
      </svg>
      {showText && (
        <div style={{ fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.05em', marginTop: 2 }}>
          {value}
        </div>
      )}
    </span>
  );
}
