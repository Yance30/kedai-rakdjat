import { rupiah } from '../money';

export interface Point {
  label: string;
  value: number;
}

const AXIS = '#9ca3af';
const GRID = '#e5e7eb';

export function BarChart({ data, color = '#8a000a', height = 150 }: { data: Point[]; color?: string; height?: number }) {
  const W = 320;
  const H = height;
  const padB = 22;
  const padT = 16;
  const max = Math.max(1, ...data.map((d) => d.value));
  const n = data.length || 1;
  const slot = W / n;
  const bw = Math.min(34, slot * 0.6);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Grafik batang pemasukan">
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <line key={f} x1={0} x2={W} y1={padT + (H - padB - padT) * (1 - f)} y2={padT + (H - padB - padT) * (1 - f)} stroke={GRID} strokeWidth={1} />
      ))}
      {data.map((d, i) => {
        const h = ((H - padB - padT) * d.value) / max;
        const x = i * slot + (slot - bw) / 2;
        const y = H - padB - h;
        return (
          <g key={i}>
            <rect x={x} y={y} width={bw} height={Math.max(1, h)} rx={4} fill={color} opacity={d.value === 0 ? 0.25 : 0.9} />
            {d.value > 0 && (
              <text x={x + bw / 2} y={y - 4} textAnchor="middle" fontSize={8.5} fill="#5b403d" className="tabular-nums">
                {short(d.value)}
              </text>
            )}
            <text x={i * slot + slot / 2} y={H - 7} textAnchor="middle" fontSize={9} fill={AXIS}>
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function AreaChart({ data, color = '#b31217', height = 140 }: { data: Point[]; color?: string; height?: number }) {
  const W = 320;
  const H = height;
  const padB = 20;
  const padT = 12;
  const max = Math.max(1, ...data.map((d) => d.value));
  const n = Math.max(1, data.length - 1);
  const px = (i: number) => (W / n) * i;
  const py = (v: number) => padT + (H - padB - padT) * (1 - v / max);
  const line = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${px(i)},${py(d.value)}`).join(' ');
  const area = `${line} L${px(data.length - 1)},${H - padB} L0,${H - padB} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Grafik tren pemasukan">
      {[0.5, 1].map((f) => (
        <line key={f} x1={0} x2={W} y1={py(max * f)} y2={py(max * f)} stroke={GRID} strokeWidth={1} />
      ))}
      {data.length > 0 && (
        <>
          <path d={area} fill={color} opacity={0.12} />
          <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
          {data.map((d, i) => (
            <circle key={i} cx={px(i)} cy={py(d.value)} r={2.5} fill={color} />
          ))}
          {data.map((d, i) => (
            <text key={i} x={px(i)} y={H - 6} textAnchor="middle" fontSize={8.5} fill={AXIS}>
              {d.label}
            </text>
          ))}
        </>
      )}
    </svg>
  );
}

export function DonutChart({ segments, centerLabel }: { segments: { label: string; value: number; color: string }[]; centerLabel: string }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = 40;
  const c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className="flex items-center gap-5">
      <svg viewBox="0 0 100 100" className="w-28 h-28 shrink-0" role="img" aria-label="Komposisi pembayaran">
        <circle cx={50} cy={50} r={r} fill="none" stroke={GRID} strokeWidth={14} />
        {total > 0 &&
          segments.map((s, i) => {
            const frac = s.value / total;
            const off = acc;
            acc += frac;
            return (
              <circle
                key={i}
                cx={50}
                cy={50}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={14}
                strokeDasharray={`${frac * c} ${c}`}
                strokeDashoffset={-off * c}
                transform="rotate(-90 50 50)"
              />
            );
          })}
        <text x={50} y={48} textAnchor="middle" fontSize={11} fontWeight={700} fill="#191c1e" className="tabular-nums">
          {short(total)}
        </text>
        <text x={50} y={60} textAnchor="middle" fontSize={7} fill={AXIS}>
          {centerLabel}
        </text>
      </svg>
      <div className="space-y-1.5">
        {segments.map((s, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <span className="w-3 h-3 rounded-full" style={{ background: s.color }} />
            <span className="text-gray-600">{s.label}</span>
            <span className="ml-auto font-semibold tabular-nums">{rupiah(s.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function RankBars({ data, color = '#8a000a' }: { data: Point[]; color?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="space-y-2.5">
      {data.length === 0 && <p className="text-sm text-gray-400">Belum ada data.</p>}
      {data.map((d, i) => (
        <div key={i}>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-700 truncate">{i + 1}. {d.label}</span>
            <span className="font-semibold tabular-nums">{rupiah(d.value)}</span>
          </div>
          <div className="h-2 rounded-full bg-gray-100">
            <div className="h-2 rounded-full" style={{ width: `${(d.value / max) * 100}%`, background: color }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function short(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace('.0', '') + 'jt';
  if (n >= 1_000) return Math.round(n / 1_000) + 'rb';
  return String(n);
}