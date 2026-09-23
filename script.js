// ---------- Header clock ----------

function updateDateTime() {
  const el = document.getElementById("datetime");
  const now = new Date();
  el.textContent = now.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }) + " · " + now.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

updateDateTime();
setInterval(updateDateTime, 1000 * 30);

// ---------- Nav (view switching) ----------
// Add a new section: give its button data-view="id" and its <section> id="view-id".
// This loop needs no changes when a new section is added.

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("view-" + btn.dataset.view).classList.add("active");
  });
});

// ---------- Home: Second Brain orb ----------
// A woven sphere of tilted rings with particles flowing round them — inspired by a
// Jarvis-style holographic globe. Pure canvas 2D, no dependencies (keeps this offline).
//
// v2 (2026-09-21): v1 left a visible rectangle behind the orb — a low-alpha dark fillRect
// every frame plus ~18 full ring strokes drawn additively every frame added light faster
// than the fade removed it, so the canvas crept brighter over time. Fixed with a full
// ctx.clearRect() every frame (true transparency = exact match to the page) instead of a
// fade approximation, glow via shadowBlur, devicePixelRatio for sharpness.
//
// v3 (2026-09-21): per-particle shadowBlur (a full blur pass per particle, per frame,
// scaled up by devicePixelRatio) was the main lag source — that's a heavy operation to
// repeat ~60+ times every frame. Replaced with a glow *sprite*: one small radial-gradient
// image pre-rendered once to an offscreen canvas, then stamped per particle with a cheap
// drawImage() — the standard technique for many-particle glow without the per-shape blur
// cost. Also lowered the devicePixelRatio cap (3x -> 2x, a 3x->2x DPR cap roughly halves
// the pixel count vs. 3x) and reduced ring/segment counts a bit. Recoloured blue instead
// of gold (Daniel's call, for originality against the Jarvis reference), and sped up the
// particles significantly per his feedback that they crawled.

(function () {
  const canvas = document.getElementById("orb-canvas");
  const ctx = canvas.getContext("2d");
  const homeView = document.getElementById("view-home");

  const DISPLAY_SIZE = 640; // CSS pixels — the orb's on-screen size
  const DPR = Math.min(window.devicePixelRatio || 1, 2);

  canvas.style.width = DISPLAY_SIZE + "px"; // height follows via CSS aspect-ratio, stays square on narrow screens
  canvas.width = DISPLAY_SIZE * DPR;
  canvas.height = DISPLAY_SIZE * DPR;
  ctx.scale(DPR, DPR);

  const W = DISPLAY_SIZE;
  const H = DISPLAY_SIZE;
  const cx = W / 2;
  const cy = H / 2;
  const RADIUS = DISPLAY_SIZE * 0.34;
  const FOCAL = DISPLAY_SIZE * 0.86;
  const SCALE_MIN = FOCAL / (FOCAL + RADIUS);
  const SCALE_MAX = FOCAL / (FOCAL - RADIUS);

  const BLUE = [90, 160, 255];
  const BLUE_BRIGHT = [214, 232, 255];

  // Pre-rendered glow sprite — stamped per particle with drawImage instead of a live
  // shadowBlur recompute per particle per frame (far cheaper at this particle count).
  const glowCanvas = document.createElement("canvas");
  glowCanvas.width = glowCanvas.height = 64;
  const glowCtx = glowCanvas.getContext("2d");
  const glowGrad = glowCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
  glowGrad.addColorStop(0, "rgba(150, 195, 255, 0.9)");
  glowGrad.addColorStop(0.45, "rgba(90, 160, 255, 0.35)");
  glowGrad.addColorStop(1, "rgba(90, 160, 255, 0)");
  glowCtx.fillStyle = glowGrad;
  glowCtx.fillRect(0, 0, 64, 64);

  const RING_COUNT = 16;
  const rings = Array.from({ length: RING_COUNT }, () => ({
    tiltX: Math.random() * Math.PI,
    tiltY: Math.random() * Math.PI,
    tiltZ: Math.random() * Math.PI,
    radius: RADIUS * (0.55 + Math.random() * 0.45),
    particles: Array.from({ length: 2 + Math.floor(Math.random() * 3) }, () => ({
      angle: Math.random() * Math.PI * 2,
      speed: (0.014 + Math.random() * 0.026) * (Math.random() < 0.5 ? 1 : -1),
    })),
  }));

  const SEGMENTS = 48;

  let autoRotY = 0;
  let tiltX = 0.3;
  let mouseX = 0;
  let mouseY = 0;
  let targetMouseX = 0;
  let targetMouseY = 0;

  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    targetMouseX = ((e.clientX - rect.left) / rect.width - 0.5) * 0.7;
    targetMouseY = ((e.clientY - rect.top) / rect.height - 0.5) * 0.5;
  });
  canvas.addEventListener("mouseleave", () => {
    targetMouseX = 0;
    targetMouseY = 0;
  });

  function rotate(p, rx, ry, rz) {
    let { x, y, z } = p;
    let c = Math.cos(rx), s = Math.sin(rx);
    let y1 = y * c - z * s, z1 = y * s + z * c;
    y = y1; z = z1;
    c = Math.cos(ry); s = Math.sin(ry);
    let x1 = x * c + z * s, z2 = -x * s + z * c;
    x = x1; z = z2;
    c = Math.cos(rz); s = Math.sin(rz);
    let x2 = x * c - y * s, y2 = x * s + y * c;
    return { x: x2, y: y2, z };
  }

  function project(p) {
    const scale = FOCAL / (FOCAL + p.z);
    return { x: cx + p.x * scale, y: cy + p.y * scale, scale };
  }

  function lerpColor(a, b, t) {
    return [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t,
    ];
  }

  function ringPoint(ring, angle) {
    let p = { x: ring.radius * Math.cos(angle), y: ring.radius * Math.sin(angle), z: 0 };
    p = rotate(p, ring.tiltX, ring.tiltY, ring.tiltZ);
    p = rotate(p, tiltX, autoRotY, 0);
    return p;
  }

  function frame() {
    requestAnimationFrame(frame);
    if (!homeView.classList.contains("active")) return;

    autoRotY += 0.0022;
    mouseX += (targetMouseX - mouseX) * 0.04;
    mouseY += (targetMouseY - mouseY) * 0.04;
    tiltX = 0.3 + mouseY;
    autoRotY += mouseX * 0.001;

    ctx.clearRect(0, 0, W, H);

    // Soft ambient glow behind the whole orb — redrawn fresh each frame, so it can't accumulate.
    const ambient = ctx.createRadialGradient(cx, cy, 0, cx, cy, RADIUS * 1.3);
    ambient.addColorStop(0, "rgba(90, 160, 255, 0.10)");
    ambient.addColorStop(1, "rgba(90, 160, 255, 0)");
    ctx.fillStyle = ambient;
    ctx.fillRect(0, 0, W, H);

    ctx.globalCompositeOperation = "lighter";

    rings.forEach((ring) => {
      ctx.beginPath();
      for (let i = 0; i <= SEGMENTS; i++) {
        const a = (i / SEGMENTS) * Math.PI * 2;
        const p = project(ringPoint(ring, a));
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = "rgba(90, 160, 255, 0.16)";
      ctx.lineWidth = 1;
      ctx.stroke();

      ring.particles.forEach((particle) => {
        particle.angle += particle.speed;
        const p3d = ringPoint(ring, particle.angle);
        const p = project(p3d);
        const depthT = Math.max(0, Math.min(1, (p.scale - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)));
        const color = lerpColor(BLUE, BLUE_BRIGHT, depthT);
        const size = 1.6 + depthT * 3;
        const alpha = 0.45 + depthT * 0.5;
        const rgb = `${Math.round(color[0])},${Math.round(color[1])},${Math.round(color[2])}`;

        const glowSize = 12 + depthT * 16;
        ctx.globalAlpha = 0.5 + depthT * 0.4;
        ctx.drawImage(glowCanvas, p.x - glowSize / 2, p.y - glowSize / 2, glowSize, glowSize);
        ctx.globalAlpha = 1;

        ctx.beginPath();
        ctx.arc(p.x, p.y, size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${rgb},${alpha})`;
        ctx.fill();
      });
    });

    // Pulsing core — the "second brain" itself.
    const pulse = 30 + Math.sin(autoRotY * 14) * 6;
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, pulse);
    core.addColorStop(0, "rgba(214, 232, 255, 0.95)");
    core.addColorStop(0.4, "rgba(90, 160, 255, 0.4)");
    core.addColorStop(1, "rgba(90, 160, 255, 0)");
    ctx.beginPath();
    ctx.arc(cx, cy, pulse, 0, Math.PI * 2);
    ctx.fillStyle = core;
    ctx.fill();

    ctx.globalCompositeOperation = "source-over";
  }

  requestAnimationFrame(frame);
})();

// ---------- Timetable ----------
// Source: read directly off Bromcom (Gordon's School student portal) by Daniel, 2026-09-21,
// week of Mon 21 Sept ("Week A") and the following week ("Week B"). Confirms + corrects
// 1. AIOS/Systems/Bromcom Timetable Pattern.md, whose old A/B labels were swapped.
// Registration/tutor group (13I, S8, Mrs L Kuwana) is identical every day, both weeks.

const bellTimes = {
  reg: "8:20 - 8:40am",
  P1: "8:40 - 9:35am",
  P2: "9:35 - 10:30am",
  break1: "10:30 - 11:00am",
  P3: "11:00 - 11:55am",
  P4a: "11:55am - 12:50pm",
  P4b: "12:50 - 1:45pm",
  P5: "1:45 - 2:40pm",
  P6: "2:40 - 3:35pm",
  break2: "3:35 - 4:00pm",
  P7: "4:00 - 4:55pm",
};

const tutorGroup = { subject: "Tutor", cls: "13I", room: "S8", teacher: "Mrs L Kuwana" };

const timetable = {
  A: {
    Mon: {
      P1: { subject: "Computing", cls: "13B/CM", room: "India 4", teacher: "Mr J Mercer" },
      P2: { subject: "Business", cls: "13C/BS", room: "WI1", teacher: "Ms N Stojakovic" },
      P7: { subject: "Chess Club", cls: "Chess MON", room: "Crimea 1", teacher: "Mr D Gellatly" },
    },
    Tue: {
      P4a: { subject: "Business", cls: "13C/BS", room: "WI1", teacher: "Ms N Stojakovic" },
      P5: { subject: "PE Core", cls: "13D/PE3", room: "Sports Hub", teacher: "Mr D Mathews" },
      P6: { subject: "Maths", cls: "13A/MA", room: "N1", teacher: "Mrs S Colloff" },
    },
    Wed: {
      P1: { subject: "Maths", cls: "13A/MA", room: "S9", teacher: "Mrs S Colloff" },
      P2: { subject: "Business", cls: "13C/BS", room: "WI3", teacher: "Mrs S Hamshar" },
      P3: { subject: "Computing", cls: "13B/CM", room: "India 2", teacher: "Mr J Sumsion" },
      P4a: { subject: "Computing", cls: "13B/CM", room: "India 2", teacher: "Mr J Sumsion" },
    },
    Thu: {
      P3: { subject: "Business", cls: "13C/BS", room: "WI3", teacher: "Mrs S Hamshar" },
      P4a: { subject: "Maths", cls: "13A/MA", room: "N1", teacher: "Mrs S Colloff" },
      P5: { subject: "Computing", cls: "13B/CM", room: "India 4", teacher: "Mr J Mercer" },
      P6: { subject: "Computing", cls: "13B/CM", room: "India 2", teacher: "Mr J Sumsion" },
    },
    Fri: {
      P1: { subject: "Business", cls: "13C/BS", room: "WI3", teacher: "Mrs S Hamshar" },
      P2: { subject: "Maths", cls: "13A/MA", room: "N1", teacher: "Mrs S Colloff" },
      P4a: { subject: "Business", cls: "13C/BS", room: "WI1", teacher: "Ms N Stojakovic" },
      P5: { subject: "PSHE", cls: "13D/PS3", room: "S8", teacher: "Mrs L Kuwana" },
      P6: { subject: "Maths", cls: "13A/MA", room: "N3", teacher: "Mr M Eaden" },
    },
  },
  B: {
    Mon: {
      P3: { subject: "Business", cls: "13C/BS", room: "WI1", teacher: "Ms N Stojakovic" },
      P4a: { subject: "Maths", cls: "13A/MA", room: "N3", teacher: "Mr M Eaden" },
      P6: { subject: "Computing", cls: "13B/CM", room: "India 4", teacher: "Mr J Mercer" },
      P7: { subject: "Chess Club", cls: "Chess MON", room: "Crimea 1", teacher: "Mr D Gellatly" },
    },
    Tue: {
      P1: { subject: "Computing", cls: "13B/CM", room: "India 2", teacher: "Mr J Sumsion" },
      P3: { subject: "PE Core", cls: "13D/PE3", room: "Sports Hub", teacher: "Mr D Mathews" },
      P4a: { subject: "PSHE", cls: "13D/PS3", room: "S8", teacher: "Mrs L Kuwana" },
      P5: { subject: "Business", cls: "13C/BS", room: "WI3", teacher: "Mrs S Hamshar" },
      P6: { subject: "Maths", cls: "13A/MA", room: "N3", teacher: "Mr M Eaden" },
    },
    Wed: {
      P1: { subject: "Computing", cls: "13B/CM", room: "India 4", teacher: "Mr J Mercer" },
      P2: { subject: "Maths", cls: "13A/MA", room: "N1", teacher: "Mrs S Colloff" },
      P3: { subject: "Business", cls: "13C/BS", room: "WI3", teacher: "Mrs S Hamshar" },
      P5: { subject: "Computing", cls: "13B/CM", room: "India 2", teacher: "Mr J Sumsion" },
      P6: { subject: "Liberal Arts", cls: "13Z/AL4", room: "Kensington 2", teacher: "Ms J Pierce" },
    },
    Thu: {
      P2: { subject: "Computing", cls: "13B/CM", room: "India 4", teacher: "Mr J Mercer" },
      P5: { subject: "Maths", cls: "13A/MA", room: "N1", teacher: "Mrs S Colloff" },
    },
    Fri: {
      P1: { subject: "Maths", cls: "13A/MA", room: "N1", teacher: "Mrs S Colloff" },
      P2: { subject: "Business", cls: "13C/BS", room: "WI3", teacher: "Mrs S Hamshar" },
      P3: { subject: "Business", cls: "13C/BS", room: "WI3", teacher: "Mrs S Hamshar" },
      P4a: { subject: "Maths", cls: "13A/MA", room: "N3", teacher: "Mr M Eaden" },
      P6: { subject: "Computing", cls: "13B/CM", room: "India 4", teacher: "Mr J Mercer" },
    },
  },
};

const days = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const dayFullNames = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday" };

// Row order, in bell-time sequence. `fixed` rows are the same every day (no lesson lookup).
const rowOrder = [
  { key: "reg", label: "Registration", fixed: true },
  { key: "P1", label: "P1" },
  { key: "P2", label: "P2" },
  { key: "break1", label: "Break", fixed: true },
  { key: "P3", label: "P3" },
  { key: "P4a", label: "P4a" },
  { key: "P4b", label: "Lunch", fixed: true },
  { key: "P5", label: "P5" },
  { key: "P6", label: "P6" },
  { key: "break2", label: "Break", fixed: true },
  { key: "P7", label: "P7" },
];

function lessonCellHTML(lesson) {
  if (!lesson) return '<span class="tt-free">Free</span>';
  return `<div class="tt-subject">${lesson.subject}</div>
          <div class="tt-meta">${lesson.cls} · ${lesson.room}</div>
          <div class="tt-meta">${lesson.teacher}</div>`;
}

function noteInputHTML(key) {
  return `<textarea class="tt-note" data-key="${key}"></textarea>`;
}

function loadNote(key) {
  try {
    return localStorage.getItem(key) || "";
  } catch (e) {
    return "";
  }
}

function saveNote(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    /* ignore — private browsing etc. */
  }
}

function renderTimetable(pattern) {
  const container = document.getElementById("timetable-grid");
  container.innerHTML = "";

  const todayIndex = new Date().getDay() - 1; // Mon=0 ... Fri=4
  const isTeachingDay = todayIndex >= 0 && todayIndex <= 4;

  const table = document.createElement("table");
  table.className = "tt-table";

  // Header row
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  headRow.innerHTML = "<th></th>" + days.map((d, i) =>
    `<th class="${isTeachingDay && i === todayIndex ? "today-col" : ""}">${dayFullNames[d]}</th>`
  ).join("");
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");

  rowOrder.forEach((row) => {
    const tr = document.createElement("tr");
    tr.className = row.fixed ? "tt-fixed-row" : "";

    const th = document.createElement("th");
    th.className = "tt-row-label";
    th.innerHTML = `${row.label}<br><span class="tt-time">${bellTimes[row.key]}</span>`;
    tr.appendChild(th);

    days.forEach((day, i) => {
      const td = document.createElement("td");
      td.className = isTeachingDay && i === todayIndex ? "today-col" : "";

      if (row.key === "reg") {
        td.innerHTML = lessonCellHTML(tutorGroup);
      } else if (row.fixed) {
        td.innerHTML = `<span class="tt-fixed-label">${row.label}</span>`;
      } else {
        const lesson = timetable[pattern][day][row.key];
        td.innerHTML = lessonCellHTML(lesson) + noteInputHTML(`note-${pattern}-${day}-${row.key}`);
        if (!lesson) td.classList.add("tt-free-cell");
      }

      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  container.appendChild(table);

  container.querySelectorAll(".tt-note").forEach((input) => {
    input.value = loadNote(input.dataset.key);
    input.addEventListener("input", () => saveNote(input.dataset.key, input.value));
  });
}

document.querySelectorAll(".pattern-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".pattern-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    renderTimetable(btn.dataset.pattern);
  });
});

document.getElementById("clear-notes-btn").addEventListener("click", () => {
  const pattern = document.querySelector(".pattern-btn.active").dataset.pattern;
  if (!confirm(`Clear all notes for Week ${pattern}?`)) return;

  try {
    days.forEach((day) => {
      rowOrder.filter((row) => !row.fixed).forEach((row) => {
        localStorage.removeItem(`note-${pattern}-${day}-${row.key}`);
      });
    });
  } catch (e) {
    /* ignore — private browsing etc. */
  }
  document.querySelectorAll(`.tt-note[data-key^="note-${pattern}-"]`).forEach((input) => {
    input.value = "";
  });
});

renderTimetable("A");

// ---------- Timesheet ----------
// Source: 4. Finance/Time Sheet.md, Summary table (updated 2026-09-02). Manual snapshot,
// not live — re-pull these numbers if Daniel says the Time Sheet note has changed.

const timesheetData = [
  { month: "Jan", hours: 0, pay: 0 },
  { month: "Feb", hours: 0, pay: 0 },
  { month: "Mar", hours: 0, pay: 0 },
  { month: "Apr", hours: 0, pay: 0 },
  { month: "May", hours: 26.25, pay: 328.13 },
  { month: "Jun", hours: 13.5, pay: 168.75 },
  { month: "Jul", hours: 1, pay: 12.50 },
  { month: "Aug", hours: 9, pay: 112.50 },
  { month: "Sep", hours: 4, pay: 50.00 },
  { month: "Oct", hours: 0, pay: 0 },
  { month: "Nov", hours: 0, pay: 0 },
  { month: "Dec", hours: 0, pay: 0 },
];

// Isometric ("3D-block") bars: a front rect + a top and side polygon, all offset by the
// same fixed depth (DEPTH_X/DEPTH_Y) for every bar — so the extrusion is purely decorative
// and never distorts how the front-face heights compare to each other.

function renderTimesheet() {
  const totalHours = timesheetData.reduce((sum, m) => sum + m.hours, 0);
  const totalPay = timesheetData.reduce((sum, m) => sum + m.pay, 0);
  document.getElementById("ts-total-pay").textContent = "£" + totalPay.toFixed(2);
  document.getElementById("ts-total-hours").textContent = totalHours.toFixed(2) + " hours · £12.50/hr";

  const wrap = document.getElementById("ts-chart");
  const tooltip = document.getElementById("ts-tooltip");

  const width = 780;
  const height = 320;
  const padLeft = 46;
  const padRight = 26;
  const padBottom = 30;
  const padTop = 28;
  const DEPTH_X = 10;
  const DEPTH_Y = 10;
  const chartW = width - padLeft - padRight - DEPTH_X;
  const chartH = height - padTop - padBottom - DEPTH_Y;
  const baseline = padTop + chartH;

  const maxPay = Math.max(...timesheetData.map((m) => m.pay)) * 1.15 || 10;
  const barSlot = chartW / timesheetData.length;
  const barWidth = barSlot - 14;

  const gridSteps = 4;
  let gridlines = "";
  let gridLabels = "";
  for (let i = 0; i <= gridSteps; i++) {
    const value = (maxPay / gridSteps) * i;
    const y = padTop + chartH - (chartH * i) / gridSteps;
    gridlines += `<line class="chart-gridline" x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" />`;
    gridLabels += `<text class="chart-axis-label" x="${padLeft - 8}" y="${y + 3}" text-anchor="end">£${Math.round(value)}</text>`;
  }

  let bars = "";
  let labels = "";
  const today = new Date();
  const currentMonthIndex = today.getFullYear() === 2026 ? today.getMonth() : -1;

  timesheetData.forEach((m, i) => {
    const barHeight = Math.max(maxPay > 0 ? (m.pay / maxPay) * chartH : 0, 2);
    const x = padLeft + i * barSlot + (barSlot - barWidth) / 2;
    const yTop = baseline - barHeight;

    const topFace = `${x},${yTop} ${x + DEPTH_X},${yTop - DEPTH_Y} ${x + barWidth + DEPTH_X},${yTop - DEPTH_Y} ${x + barWidth},${yTop}`;
    const sideFace = `${x + barWidth},${yTop} ${x + barWidth + DEPTH_X},${yTop - DEPTH_Y} ${x + barWidth + DEPTH_X},${baseline - DEPTH_Y} ${x + barWidth},${baseline}`;
    const isCurrent = i === currentMonthIndex;

    bars += `
      <g class="chart-bar-group${isCurrent ? " current" : ""}" data-i="${i}">
        <polygon class="chart-bar-side" points="${sideFace}" />
        <rect class="chart-bar-front" x="${x}" y="${yTop}" width="${barWidth}" height="${barHeight}" />
        <polygon class="chart-bar-top" points="${topFace}" />
      </g>`;
    labels += `<text class="chart-axis-label${isCurrent ? " current" : ""}" x="${x + barWidth / 2}" y="${height - 8}" text-anchor="middle">${m.month}</text>`;
  });

  wrap.innerHTML = `<svg viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="barFrontGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style="stop-color:var(--accent-bright)" />
          <stop offset="100%" style="stop-color:var(--accent)" />
        </linearGradient>
      </defs>
      ${gridlines}${gridLabels}${bars}${labels}
    </svg>`;

  // Entrance animation: draw at scale 0, then grow — double rAF so the browser paints the
  // zero state first (otherwise the transition can get skipped).
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      wrap.querySelectorAll(".chart-bar-group").forEach((g, i) => {
        g.style.transitionDelay = (i * 35) + "ms";
        g.classList.add("grown");
      });
    });
  });

  wrap.querySelectorAll(".chart-bar-group").forEach((group) => {
    group.addEventListener("mousemove", (e) => {
      const m = timesheetData[Number(group.dataset.i)];
      const cardRect = tooltip.offsetParent.getBoundingClientRect();
      tooltip.innerHTML = `<div class="tt-month">${m.month}</div>£${m.pay.toFixed(2)} · ${m.hours}h`;
      tooltip.style.left = (e.clientX - cardRect.left) + "px";
      tooltip.style.top = (e.clientY - cardRect.top - 10) + "px";
      tooltip.classList.add("visible");
    });
    group.addEventListener("mouseleave", () => tooltip.classList.remove("visible"));
  });
}

renderTimesheet();

// ---------- Fitness (Fitbit) ----------
// Talks to this deployment's own /api/fitbit/* serverless routes — see api/fitbit/ in the
// repo. Needs an internet connection; if you're offline this just shows the error state
// rather than breaking the rest of the dashboard.

async function loadFitness() {
  const disconnected = document.getElementById("fitness-disconnected");
  const errorBox = document.getElementById("fitness-error");
  const errorMessage = document.getElementById("fitness-error-message");
  const stats = document.getElementById("fitness-stats");

  disconnected.hidden = true;
  errorBox.hidden = true;
  stats.hidden = true;

  try {
    const response = await fetch("/api/fitbit/summary");
    const data = await response.json();

    if (!data.connected) {
      if (data.error) {
        errorMessage.textContent = "Fitbit said: " + data.error;
        errorBox.hidden = false;
      } else {
        disconnected.hidden = false;
      }
      return;
    }

    document.getElementById("fit-steps").textContent = data.steps.toLocaleString();
    document.getElementById("fit-sleep").textContent = data.sleepHours !== null ? data.sleepHours + "h" : "–";
    document.getElementById("fit-hr").textContent = data.restingHeartRate !== null ? data.restingHeartRate : "–";
    document.getElementById("fit-active").textContent = data.activeMinutes;
    stats.hidden = false;
  } catch (e) {
    errorMessage.textContent = "Couldn't reach the server — check your internet connection.";
    errorBox.hidden = false;
  }
}

document.querySelector('.nav-btn[data-view="fitness"]').addEventListener("click", loadFitness);

// If Fitbit just redirected back here after connecting, land straight on the Fitness tab.
if (new URLSearchParams(window.location.search).get("fitbit") === "connected") {
  document.querySelector('.nav-btn[data-view="fitness"]').click();
}
