/**
 * Canvas chart primitives for the Hyperdash demo.
 *
 * A miniature charting library: candlesticks with volume, area/line series,
 * horizontal bar distribution, sparklines and a price-depth ladder. It uses a
 * HiDPI canvas, `devicePixelRatio`-aware sizing, hover crosshairs with a
 * tooltip callback, and theme tokens supplied by the caller so both design
 * directions (dash and terminal) can share the same code.
 */

function setupCanvas(canvas, cssWidth, cssHeight) {
  const ratio = Math.min(globalThis.devicePixelRatio || 1, 2.5);
  canvas.width = Math.max(1, Math.round(cssWidth * ratio));
  canvas.height = Math.max(1, Math.round(cssHeight * ratio));
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  return { ctx, width: cssWidth, height: cssHeight, ratio };
}

function niceTicks(min, max, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [min];
  const span = max - min;
  const step0 = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(step0));
  const normalised = step0 / magnitude;
  const step = (normalised >= 7.5 ? 10 : normalised >= 3.5 ? 5 : normalised >= 1.5 ? 2 : 1) * magnitude;
  const start = Math.ceil(min / step) * step;
  const ticks = [];
  for (let value = start; value <= max + step * 0.001; value += step) ticks.push(Number(value.toFixed(10)));
  return ticks;
}

function token(theme, name, fallback) {
  return theme?.[name] ?? fallback;
}

function formatAxisValue(value, formatter) {
  return formatter ? formatter(value) : String(Math.round(value));
}

function bindHover(canvas, { xTicks, bounds, onHover }) {
  const previous = canvas.__hdHover;
  if (previous) {
    canvas.removeEventListener('pointermove', previous.move);
    canvas.removeEventListener('pointerleave', previous.leave);
  }
  if (!onHover) { canvas.__hdHover = null; return; }
  const move = (event) => {
    const rect = canvas.getBoundingClientRect();
    onHover({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
      bounds,
      xTicks,
    });
  };
  const leave = () => onHover({ leave: true });
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerleave', leave);
  canvas.__hdHover = { move, leave };
}

/* --------------------------------------------------------------------------
   Candles
   -------------------------------------------------------------------------- */

export function drawCandles(canvas, rows, {
  theme = {}, width, height, showVolume = true, formatter, onHover, overlay = null,
} = {}) {
  const host = canvas.parentElement;
  const cssWidth = Math.max(160, width ?? host?.clientWidth ?? canvas.clientWidth ?? 640);
  const cssHeight = Math.max(120, height ?? host?.clientHeight ?? canvas.clientHeight ?? 320);
  const padTop = 14;
  const padBottom = showVolume ? 46 : 22;
  const padLeft = 8;
  const padRight = 62;
  const volumeHeight = showVolume ? 30 : 0;

  if (!rows?.length) {
    const { ctx } = setupCanvas(canvas, cssWidth, cssHeight);
    ctx.fillStyle = token(theme, 'muted', '#888');
    ctx.font = '12px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText('No candles for this range', padLeft + 6, cssHeight / 2);
    bindHover(canvas, { onHover: null });
    return null;
  }

  const opens = rows.map((row) => Number(row.o));
  const highs = rows.map((row) => Number(row.h));
  const lows = rows.map((row) => Number(row.l));
  const closes = rows.map((row) => Number(row.c));
  const volumes = rows.map((row) => Number(row.v));
  const maxHigh = Math.max(...highs);
  const minLow = Math.min(...lows);
  const padding = (maxHigh - minLow) * 0.08 || maxHigh * 0.01;
  const top = maxHigh + padding;
  const bottom = minLow - padding;
  const plotWidth = cssWidth - padLeft - padRight;
  const priceHeight = cssHeight - padTop - padBottom;
  const bodySpace = plotWidth / rows.length;
  const candleWidth = Math.max(1, Math.min(14, bodySpace * 0.62));
  const maxVolume = Math.max(...volumes, 1);
  const chartBottom = cssHeight - padBottom + (showVolume ? 6 : 0);

  const yOf = (value) => padTop + ((top - value) / (top - bottom)) * (priceHeight - (showVolume ? volumeHeight + 8 : 0));
  const xOf = (index) => padLeft + bodySpace * index + bodySpace / 2;

  function paint(hoverIndex = -1) {
    const { ctx } = setupCanvas(canvas, cssWidth, cssHeight);
    ctx.strokeStyle = token(theme, 'grid', 'rgba(255,255,255,0.07)');
    ctx.lineWidth = 1;
    ctx.font = `${token(theme, 'axisFontSize', 10)}px ${token(theme, 'mono', 'ui-monospace, monospace')}`;
    ctx.fillStyle = token(theme, 'muted', '#8b8b8b');
    for (const tick of niceTicks(bottom, top, 5)) {
      const y = Math.round(yOf(tick)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(cssWidth - padRight, y);
      ctx.stroke();
      ctx.fillText(formatAxisValue(tick, formatter), cssWidth - padRight + 8, y + 3.5);
    }

    if (overlay?.length === rows.length) {
      const oMin = Math.min(...overlay);
      const oMax = Math.max(...overlay);
      ctx.beginPath();
      overlay.forEach((value, index) => {
        const y = padTop + ((oMax - value) / Math.max(1e-9, oMax - oMin)) * (priceHeight - volumeHeight - 8);
        if (index === 0) ctx.moveTo(xOf(index), y);
        else ctx.lineTo(xOf(index), y);
      });
      ctx.strokeStyle = token(theme, 'accentAlt', 'rgba(90,169,255,0.7)');
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }

    const upColor = token(theme, 'up', '#16c784');
    const downColor = token(theme, 'down', '#ea3943');
    for (let index = 0; index < rows.length; index += 1) {
      const rising = closes[index] >= opens[index];
      const colour = rising ? upColor : downColor;
      const x = xOf(index);
      ctx.strokeStyle = colour;
      ctx.fillStyle = colour;
      ctx.lineWidth = Math.max(1, Math.min(1.6, candleWidth * 0.22));
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, yOf(highs[index]));
      ctx.lineTo(Math.round(x) + 0.5, yOf(lows[index]));
      ctx.stroke();
      const bodyTop = yOf(Math.max(opens[index], closes[index]));
      const bodyBottom = yOf(Math.min(opens[index], closes[index]));
      const bodyHeight = Math.max(1, bodyBottom - bodyTop);
      if (candleWidth <= 2.2) {
        ctx.fillRect(x - 0.75, bodyTop, 1.5, bodyHeight);
      } else {
        ctx.fillRect(x - candleWidth / 2, bodyTop, candleWidth, bodyHeight);
        if (!rising) {
          const inset = Math.min(2, candleWidth * 0.18);
          if (bodyHeight > inset * 2 + 1) {
            ctx.fillStyle = token(theme, 'surface', '#0b0b0b');
            ctx.fillRect(x - candleWidth / 2 + inset, bodyTop + inset, candleWidth - inset * 2, bodyHeight - inset * 2);
          }
        }
      }
      if (showVolume) {
        const barHeight = (volumes[index] / maxVolume) * volumeHeight;
        ctx.globalAlpha = 0.42;
        ctx.fillStyle = colour;
        ctx.fillRect(x - candleWidth / 2, chartBottom - barHeight, Math.max(1, candleWidth), barHeight);
        ctx.globalAlpha = 1;
      }
    }

    const last = closes.at(-1);
    const lastY = yOf(last);
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = token(theme, 'lastLine', 'rgba(253,89,43,0.8)');
    ctx.beginPath();
    ctx.moveTo(padLeft, lastY);
    ctx.lineTo(cssWidth - padRight, lastY);
    ctx.stroke();
    ctx.setLineDash([]);
    const label = formatAxisValue(last, formatter);
    ctx.font = `600 ${token(theme, 'axisFontSize', 10)}px ${token(theme, 'mono', 'ui-monospace, monospace')}`;
    const labelWidth = Math.min(padRight - 4, ctx.measureText(label).width + 10);
    ctx.fillStyle = token(theme, 'accent', '#FD592B');
    ctx.fillRect(cssWidth - padRight + 2, lastY - 9, labelWidth, 18);
    ctx.fillStyle = token(theme, 'accentInk', '#1a0d09');
    ctx.fillText(label, cssWidth - padRight + 7, lastY + 4);

    if (hoverIndex >= 0 && rows[hoverIndex]) {
      const x = xOf(hoverIndex);
      ctx.strokeStyle = token(theme, 'crosshair', 'rgba(255,255,255,0.24)');
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, padTop);
      ctx.lineTo(Math.round(x) + 0.5, chartBottom);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  paint();
  bindHover(canvas, {
    onHover: onHover ? (state) => {
      if (state.leave) { paint(); onHover({ leave: true }); return; }
      const index = Math.min(rows.length - 1, Math.max(0, Math.floor((state.x - padLeft) / bodySpace)));
      paint(index);
      onHover({ index, row: rows[index], x: xOf(index), y: state.y, bounds: { padLeft, padRight, padTop, chartBottom, bodySpace, cssWidth, cssHeight } });
    } : null,
  });
  return { yOf, xOf, rows, paint, layout: { padLeft, padRight, padTop, chartBottom, bodySpace, cssWidth, cssHeight } };
}

/* --------------------------------------------------------------------------
   Area / line
   -------------------------------------------------------------------------- */

export function drawArea(canvas, rows, {
  theme = {}, width, height, xKey = 't', yKey = 'c', formatter, axisFormatter = null, area = true, onHover, baseline = null, fill,
} = {}) {
  const host = canvas.parentElement;
  const cssWidth = Math.max(160, width ?? host?.clientWidth ?? 420);
  const cssHeight = Math.max(80, height ?? host?.clientHeight ?? 180);
  const padLeft = 6;
  const padRight = 6;
  const padTop = 10;
  const padBottom = 18;
  if (!rows?.length) return null;
  const values = rows.map((row) => Number(row[yKey]));
  const min = Math.min(...values, ...(baseline !== null ? [baseline] : []));
  const max = Math.max(...values, ...(baseline !== null ? [baseline] : []));
  const span = max - min || Math.abs(max) || 1;
  const yOf = (value) => padTop + ((max - value) / span) * (cssHeight - padTop - padBottom);
  const xOf = (index) => padLeft + (index / Math.max(1, rows.length - 1)) * (cssWidth - padLeft - padRight);
  const colour = fill ?? token(theme, 'accentAlt', '#5aa9ff');

  function paint(hoverIndex = -1) {
    const { ctx } = setupCanvas(canvas, cssWidth, cssHeight);
    if (baseline !== null) {
      const y = Math.round(yOf(baseline)) + 0.5;
      ctx.strokeStyle = token(theme, 'grid', 'rgba(255,255,255,0.08)');
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(cssWidth - padRight, y);
      ctx.stroke();
    }
    const path = new Path2D();
    values.forEach((value, index) => {
      if (index === 0) path.moveTo(xOf(index), yOf(value));
      else path.lineTo(xOf(index), yOf(value));
    });
    if (area) {
      const gradient = ctx.createLinearGradient(0, padTop, 0, cssHeight);
      gradient.addColorStop(0, token(theme, 'areaFrom', 'rgba(253,89,43,0.32)'));
      gradient.addColorStop(1, token(theme, 'areaTo', 'rgba(253,89,43,0)'));
      const fillPath = new Path2D(path);
      fillPath.lineTo(xOf(values.length - 1), cssHeight - padBottom);
      fillPath.lineTo(xOf(0), cssHeight - padBottom);
      fillPath.closePath();
      ctx.fillStyle = gradient;
      ctx.fill(fillPath);
    }
    ctx.strokeStyle = colour;
    ctx.lineWidth = token(theme, 'lineWidth', 1.8);
    ctx.lineJoin = 'round';
    ctx.stroke(path);

    ctx.font = `${token(theme, 'axisFontSize', 10)}px ${token(theme, 'mono', 'ui-monospace, monospace')}`;
    ctx.fillStyle = token(theme, 'muted', '#777');
    ctx.fillText(formatter ? formatter(rows[0][xKey], rows[0]) : String(rows[0][xKey]), padLeft, cssHeight - 4);
    ctx.textAlign = 'right';
    ctx.fillText(formatter ? formatter(rows.at(-1)[xKey], rows.at(-1)) : String(rows.at(-1)[xKey]), cssWidth - padRight, cssHeight - 4);
    ctx.textAlign = 'left';
    if (axisFormatter) {
      for (const tick of niceTicks(min, max, 3)) {
        const y = yOf(tick);
        ctx.fillStyle = token(theme, 'muted', '#777');
        ctx.fillText(axisFormatter(tick), padLeft, Math.max(9, y - 3));
      }
    }
    if (hoverIndex >= 0) {
      const x = xOf(hoverIndex);
      ctx.strokeStyle = token(theme, 'crosshair', 'rgba(255,255,255,0.22)');
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, padTop);
      ctx.lineTo(Math.round(x) + 0.5, cssHeight - padBottom);
      ctx.stroke();
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.arc(x, yOf(values[hoverIndex]), 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  paint();
  bindHover(canvas, {
    onHover: onHover ? (state) => {
      if (state.leave) { paint(); onHover({ leave: true }); return; }
      const index = Math.min(rows.length - 1, Math.max(0, Math.round(((state.x - padLeft) / (cssWidth - padLeft - padRight)) * (rows.length - 1))));
      paint(index);
      onHover({ index, row: rows[index], x: xOf(index), y: yOf(values[index]) });
    } : null,
  });
  return { xOf, yOf, rows, paint };
}

/* --------------------------------------------------------------------------
   Horizontal distribution (liquidation ladders, cohorts, levels)
   -------------------------------------------------------------------------- */

export function drawHBars(canvas, rows, {
  theme = {}, width, height, labelKey = 'label', valueKey = 'value', formatter, split = null,
} = {}) {
  const host = canvas.parentElement;
  const cssWidth = Math.max(200, width ?? host?.clientWidth ?? 480);
  const rowHeight = 22;
  const cssHeight = Math.max(rowHeight * 2, height ?? rows.length * rowHeight + 8);
  const { ctx } = setupCanvas(canvas, cssWidth, cssHeight);
  if (!rows?.length) return null;
  const labelWidth = Math.min(120, cssWidth * 0.3);
  const valueWidth = 82;
  const plotWidth = cssWidth - labelWidth - valueWidth - 16;
  const max = Math.max(...rows.map((row) => Number(row[valueKey])), 1);
  ctx.font = `${token(theme, 'axisFontSize', 10)}px ${token(theme, 'mono', 'ui-monospace, monospace')}`;
  rows.forEach((row, index) => {
    const y = index * rowHeight + 4;
    const value = Number(row[valueKey]);
    const barWidth = Math.max(2, (value / max) * plotWidth);
    const positive = value >= 0;
    ctx.fillStyle = positive ? token(theme, 'upSoft', 'rgba(22,199,132,0.6)') : token(theme, 'downSoft', 'rgba(234,57,67,0.6)');
    if (split) {
      const negative = Math.abs(Math.min(0, value));
      const bar = Math.max(1, (negative / max) * plotWidth);
      ctx.fillRect(labelWidth + plotWidth - bar + 8, y + 3, bar, rowHeight - 10);
    } else {
      ctx.fillRect(labelWidth + 8, y + 3, barWidth, rowHeight - 10);
    }
    ctx.fillStyle = token(theme, 'text', '#e7e7e7');
    ctx.textAlign = 'right';
    ctx.fillText(String(row[labelKey]), labelWidth, y + rowHeight / 2 + 3);
    ctx.textAlign = 'left';
    ctx.fillStyle = token(theme, 'muted', '#9a9a9a');
    ctx.fillText(formatter ? formatter(value) : String(value), labelWidth + plotWidth + 16, y + rowHeight / 2 + 3);
  });
  return { height: cssHeight };
}

/* --------------------------------------------------------------------------
   Vertical bars (credit burn, volumes)
   -------------------------------------------------------------------------- */

export function drawBars(canvas, values, { theme = {}, width, height, formatter = null, highlightLast = true } = {}) {
  const host = canvas.parentElement;
  const cssWidth = Math.max(120, width ?? host?.clientWidth ?? 420);
  const cssHeight = Math.max(60, height ?? host?.clientHeight ?? 110);
  const { ctx } = setupCanvas(canvas, cssWidth, cssHeight);
  if (!values?.length) return null;
  const padTop = 8;
  const padBottom = 12;
  const max = Math.max(...values, 1);
  const gap = values.length > 24 ? 1 : 2;
  const barWidth = Math.max(1, (cssWidth - gap * (values.length - 1)) / values.length);
  ctx.fillStyle = token(theme, 'grid', 'rgba(255,255,255,0.08)');
  ctx.fillRect(0, cssHeight - padBottom + 0.5, cssWidth, 1);
  values.forEach((value, index) => {
    const barHeight = Math.max(value === 0 ? 0.5 : 1, (value / max) * (cssHeight - padTop - padBottom));
    const x = index * (barWidth + gap);
    const isLast = highlightLast && index === values.length - 1;
    ctx.fillStyle = isLast
      ? token(theme, 'accent', '#fd592b')
      : value === 0
        ? token(theme, 'grid', 'rgba(255,255,255,0.14)')
        : token(theme, 'bar', 'rgba(120,120,120,0.5)');
    ctx.fillRect(x, cssHeight - padBottom - barHeight, barWidth, barHeight);
  });
  if (formatter) {
    ctx.font = `10px ${token(theme, 'mono', 'monospace')}`;
    ctx.fillStyle = token(theme, 'muted', '#888');
    ctx.fillText(formatter(max), 2, 10);
  }
  return { max };
}

/* --------------------------------------------------------------------------
   Sparkline
   -------------------------------------------------------------------------- */

export function drawSparkline(canvas, values, { theme = {}, width, height = 34, fill = null, baseline = null } = {}) {
  const host = canvas.parentElement;
  const cssWidth = Math.max(40, width ?? host?.clientWidth ?? 120);
  const { ctx } = setupCanvas(canvas, cssWidth, height);
  if (!values.length) return;
  const min = Math.min(...values, ...(baseline !== null ? [baseline] : []));
  const max = Math.max(...values, ...(baseline !== null ? [baseline] : []));
  const span = max - min || 1;
  const pad = 3;
  const yOf = (value) => pad + ((max - value) / span) * (height - pad * 2);
  const xOf = (index) => (index / Math.max(1, values.length - 1)) * cssWidth;
  const path = new Path2D();
  values.forEach((value, index) => {
    if (index === 0) path.moveTo(xOf(index), yOf(value));
    else path.lineTo(xOf(index), yOf(value));
  });
  if (fill) {
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, `${fill}55`);
    grad.addColorStop(1, `${fill}00`);
    const area = new Path2D(path);
    area.lineTo(cssWidth, height);
    area.lineTo(0, height);
    area.closePath();
    ctx.fillStyle = grad;
    ctx.fill(area);
  }
  ctx.strokeStyle = fill ?? token(theme, 'accent', '#FD592B');
  ctx.lineWidth = 1.4;
  ctx.lineJoin = 'round';
  ctx.stroke(path);
}

/* --------------------------------------------------------------------------
   Depth ladder (book)
   -------------------------------------------------------------------------- */

export function drawDepth(canvas, book, { theme = {}, width, height, formatter } = {}) {
  const host = canvas.parentElement;
  const cssWidth = Math.max(240, width ?? host?.clientWidth ?? 480);
  const cssHeight = Math.max(120, height ?? host?.clientHeight ?? 220);
  const { ctx } = setupCanvas(canvas, cssWidth, cssHeight);
  if (!book?.bids?.length) return null;
  const bids = [...book.bids].slice(0, 14).map((level) => ({ ...level, cumulative: 0 }));
  const asks = [...book.asks].slice(0, 14).map((level) => ({ ...level, cumulative: 0 }));
  let running = 0;
  for (const bid of bids) { running += Number(bid.sz) * Number(bid.px); bid.total = running; }
  running = 0;
  for (const ask of asks) { running += Number(ask.sz) * Number(ask.px); ask.total = running; }
  const mid = Number(book.mid_px);
  const maxTotal = Math.max(running, bids.at(-1)?.total ?? 1);
  const half = cssWidth / 2;
  const barHeight = (cssHeight - 26) / Math.max(bids.length, asks.length);
  const upColor = token(theme, 'up', '#16c784');
  const downColor = token(theme, 'down', '#ea3943');
  ctx.font = `${token(theme, 'axisFontSize', 10)}px ${token(theme, 'mono', 'ui-monospace, monospace')}`;

  bids.forEach((level, index) => {
    const barWidth = (level.total / maxTotal) * (half - 8);
    ctx.fillStyle = token(theme, 'upSoft', 'rgba(22,199,132,0.18)');
    ctx.fillRect(half - 4 - barWidth, 8 + index * barHeight, barWidth, barHeight - 2);
    ctx.fillStyle = upColor;
    ctx.textAlign = 'right';
    ctx.fillText(formatter ? formatter(level.px) : level.px, half - 12, 8 + index * barHeight + barHeight / 2 + 3);
  });
  asks.forEach((level, index) => {
    const barWidth = (level.total / maxTotal) * (half - 8);
    ctx.fillStyle = token(theme, 'downSoft', 'rgba(234,57,67,0.18)');
    ctx.fillRect(half + 4, 8 + index * barHeight, barWidth, barHeight - 2);
    ctx.fillStyle = downColor;
    ctx.textAlign = 'left';
    ctx.fillText(formatter ? formatter(level.px) : level.px, half + 12, 8 + index * barHeight + barHeight / 2 + 3);
  });
  ctx.textAlign = 'center';
  ctx.fillStyle = token(theme, 'text', '#f0f0f0');
  ctx.fillText(`mid ${formatter ? formatter(mid) : mid}`, half, cssHeight - 4);
  ctx.textAlign = 'left';
  return { maxTotal };
}

/* --------------------------------------------------------------------------
   Heatmap grid (positioning / footprint)
   -------------------------------------------------------------------------- */

export function drawHeatmap(canvas, matrix, { theme = {}, width, height, labels = [], valueLabels = [], formatter } = {}) {
  const host = canvas.parentElement;
  const cssWidth = Math.max(240, width ?? host?.clientWidth ?? 520);
  const labelWidth = 56;
  const cssHeight = Math.max(120, height ?? matrix.length * 22 + 30);
  const { ctx } = setupCanvas(canvas, cssWidth, cssHeight);
  if (!matrix.length) return null;
  const columns = matrix[0].length;
  const cellWidth = (cssWidth - labelWidth - 8) / columns;
  const rowHeight = (cssHeight - 24) / matrix.length;
  const flat = matrix.flat().map(Number);
  const maxAbs = Math.max(...flat.map((value) => Math.abs(value)), 0.0001);
  ctx.font = `${token(theme, 'axisFontSize', 9)}px ${token(theme, 'mono', 'ui-monospace, monospace')}`;
  matrix.forEach((row, rowIndex) => {
    if (labels[rowIndex]) {
      ctx.fillStyle = token(theme, 'muted', '#999');
      ctx.textAlign = 'right';
      ctx.fillText(labels[rowIndex], labelWidth - 6, rowIndex * rowHeight + rowHeight / 2 + 3);
      ctx.textAlign = 'left';
    }
    row.forEach((value, columnIndex) => {
      const ratio = Math.abs(Number(value)) / maxAbs;
      const positive = Number(value) >= 0;
      const alpha = 0.08 + ratio * 0.82;
      ctx.fillStyle = positive ? `rgba(22,199,132,${alpha})` : `rgba(234,57,67,${alpha})`;
      ctx.fillRect(labelWidth + columnIndex * cellWidth + 1, rowIndex * rowHeight + 1, cellWidth - 2, rowHeight - 2);
      if (cellWidth > 42 && ratio > 0.55) {
        ctx.fillStyle = 'rgba(8,10,12,0.82)';
        ctx.fillText(formatter ? formatter(value) : String(Math.round(value)), labelWidth + columnIndex * cellWidth + 4, rowIndex * rowHeight + rowHeight / 2 + 3);
      }
    });
  });
  ctx.fillStyle = token(theme, 'muted', '#999');
  valueLabels.forEach((label, index) => {
    ctx.fillText(label, labelWidth + index * cellWidth + 2, cssHeight - 6);
  });
  return { cssHeight };
}
