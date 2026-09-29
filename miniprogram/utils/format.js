// 中国习惯：涨=红，跌=绿
const UP = '#e24b4a';
const DOWN = '#2f9e5e';
const FLAT = '#78809a';

function num(v, digits = 2) {
  if (v === null || v === undefined || v === '' || Number.isNaN(Number(v))) return '--';
  return Number(v).toFixed(digits);
}

function pct(v, digits = 2) {
  if (v === null || v === undefined || v === '' || Number.isNaN(Number(v))) return '--';
  return `${(Number(v) * 100).toFixed(digits)}%`;
}

function signed(v, digits = 2, suffix = '%') {
  if (v === null || v === undefined || v === '' || Number.isNaN(Number(v))) return '--';
  const n = Number(v);
  const s = n > 0 ? '+' : '';
  return `${s}${n.toFixed(digits)}${suffix}`;
}

function changeColor(v) {
  if (v === null || v === undefined || Number.isNaN(Number(v)) || Number(v) === 0) return FLAT;
  return Number(v) > 0 ? UP : DOWN;
}

// 走势线按该段序列自身的首尾涨跌着色：线往上走=红，往下走=绿
function trendColor(series) {
  if (!Array.isArray(series) || series.length < 2) return FLAT;
  const a = Number(series[0]);
  const b = Number(series[series.length - 1]);
  if (Number.isNaN(a) || Number.isNaN(b) || a === b) return FLAT;
  return b > a ? UP : DOWN;
}

// 估值状态：低估=机会(绿)，适中=中性(橙)，高估=风险(红)
const EVA_MAP = {
  low: { text: '低估', cls: 'eva-low' },
  mid: { text: '适中', cls: 'eva-mid' },
  high: { text: '高估', cls: 'eva-high' },
};

function evaInfo(t) {
  return EVA_MAP[t] || { text: '--', cls: 'eva-none' };
}

function tempText(t) {
  if (t === null || t === undefined) return '暂无温度';
  return `${Math.round(t)}°`;
}

function tempColor(t) {
  if (t === null || t === undefined) return FLAT;
  if (t < 30) return '#2f9e5e';
  if (t < 50) return '#d2601a';
  return '#b3352c';
}

function shortTime(iso) {
  if (!iso) return '';
  // 2026-09-29T06:03:55.087Z → 09-29 14:03（按本地时区）
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

module.exports = { UP, DOWN, FLAT, num, pct, signed, changeColor, trendColor, evaInfo, tempText, tempColor, shortTime };
