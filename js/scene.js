/* Momentjes V2 — de wereld: bomen, twijgen, blaadjes.
   De vormen zijn met de hand gelegd (asymmetrisch, ongelijk);
   code hangt alleen de blaadjes op. Elke maand heeft een eigen twijg,
   dus een jaar kan moeiteloos 100+ momentjes dragen — en een lege
   maand is gewoon een kale twijg. */

const Scene = (() => {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';

  const SEASON = {
    winter: ['#DAE2DA', '#C8D3C8'],
    lente:  ['#A9CC7D', '#96BA6B', '#B8D68F'],
    zomer:  ['#7FA95B', '#5E8E4E', '#8FB56A'],
    herfst: ['#D98E3B', '#C96F35', '#B85C4A'],
  };
  const GOUD = '#F2CC5E';
  const HOUT = '#8A6F52';
  const seasonOf = m => (m <= 1 || m === 11) ? 'winter' : m <= 4 ? 'lente' : m <= 7 ? 'zomer' : 'herfst';

  /* ===== Handgelegde boom: stam-ankers + één twijg per maand =====
     x-wiebel en twijglengtes zijn met de hand gekozen — niet gelijkmatig. */
  const TRUNK = [
    { x: 210, y: 812 },
    { x: 206, y: 758 }, { x: 212, y: 704 }, { x: 206, y: 648 }, { x: 202, y: 592 },
    { x: 209, y: 534 }, { x: 205, y: 478 }, { x: 200, y: 424 }, { x: 208, y: 368 },
    { x: 203, y: 314 }, { x: 210, y: 262 }, { x: 204, y: 214 }, { x: 209, y: 170 },
    { x: 205, y: 138 },
  ];
  //             jan  feb  mrt  apr  mei  jun  jul  aug  sep  okt  nov  dec
  const T_LEN  = [ 64,  58,  88,  80, 106,  98, 110,  88,  94,  86,  66,  56];
  const T_SIDE = [ -1,   1,  -1,   1,  -1,   1,  -1,   1,  -1,   1,  -1,   1];
  const T_LIFT = [0.34,0.40,0.38,0.44,0.40,0.46,0.42,0.48,0.44,0.42,0.46,0.38];

  function trunkPath(uptoMonth) {
    // Soepele curve door de ankers, tot (en met) de twijg van deze maand
    const pts = TRUNK.slice(0, Math.min(uptoMonth + 3, TRUNK.length));
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i], q = pts[i - 1];
      const my = (p.y + q.y) / 2;
      d += ` C ${q.x} ${my} ${p.x} ${my} ${p.x} ${p.y}`;
    }
    return d;
  }

  function twigPath(m) {
    const a = TRUNK[m + 1];
    const L = T_LEN[m], side = T_SIDE[m];
    const tip = { x: a.x + side * L, y: a.y - L * T_LIFT[m] };
    const ctrl = { x: a.x + side * L * 0.45, y: a.y - L * 0.05 };
    return { d: `M ${a.x} ${a.y} Q ${ctrl.x} ${ctrl.y} ${tip.x} ${tip.y}`, tip };
  }

  /* Bladgrootte krimpt zachtjes naarmate een maand voller hangt */
  function leafSize(countInMonth) {
    if (countInMonth <= 2) return { rx: 15, ry: 9.5 };
    if (countInMonth <= 5) return { rx: 13.5, ry: 8.5 };
    if (countInMonth <= 10) return { rx: 12, ry: 7.6 };
    return { rx: 10.5, ry: 6.8 };
  }

  const rnd = (seed) => { const x = Math.sin(seed * 999.7) * 10000; return x - Math.floor(x); };

  function makeLeaf({ x, y, rot, rx, ry, fill, goud, seed }) {
    const g = document.createElementNS(NS, 'g');
    g.classList.add('leaf');
    g.style.translate = `${x.toFixed(1)}px ${y.toFixed(1)}px`;
    const inner = document.createElementNS(NS, 'ellipse');
    inner.setAttribute('rx', rx); inner.setAttribute('ry', ry);
    inner.setAttribute('fill', fill);
    inner.classList.add('leaf-inner');
    inner.style.rotate = rot.toFixed(1) + 'deg';
    inner.style.setProperty('--dur', (3.6 + rnd(seed) * 2.6).toFixed(2) + 's');
    inner.style.setProperty('--del', (-rnd(seed + 1) * 4).toFixed(2) + 's');
    g.appendChild(inner);
    if (goud) {
      [[rx + 4, -ry - 3, 0.3], [-rx - 2, -2, 2.1], [3, ry + 4, 3.7]].forEach(([sx, sy, d]) => {
        const s = document.createElementNS(NS, 'path');
        s.setAttribute('d', 'M0,-4 L1,-1 L4,0 L1,1 L0,4 L-1,1 L-4,0 L-1,-1 Z');
        s.setAttribute('fill', '#FFF3C4');
        s.setAttribute('transform', `translate(${sx} ${sy})`);
        s.classList.add('spark');
        s.style.setProperty('--sd', d + 's');
        g.appendChild(s);
      });
    }
    return g;
  }

  const mkPath = (d, w, cap = 'round') => {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d); p.setAttribute('fill', 'none');
    p.setAttribute('stroke', HOUT); p.setAttribute('stroke-width', w);
    p.setAttribute('stroke-linecap', cap);
    return p;
  };

  /* Kleur betekent per modus precies één ding:
     'seizoen'  → blad kleurt met het seizoen mee
     'categorie'→ blad draagt de kleur van zijn categorie (proef) */
  let colorMode = 'seizoen';
  let catColorOf = () => null;

  function leafColor(mem, i) {
    if (mem.isFavorite) return GOUD;
    if (colorMode === 'categorie') {
      const base = catColorOf(mem.categoryId);
      if (base) return i % 2 ? base : shade(base, i % 4 === 2 ? -14 : 10);
    }
    const pal = SEASON[seasonOf(new Date(mem.date).getMonth())];
    return pal[i % pal.length];
  }

  function shade(hex, pct) {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => Math.max(0, Math.min(255, Math.round(v + (pct / 100) * 255)));
    return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => f(v).toString(16).padStart(2, '0')).join('');
  }

  /* ===== Eén boom tekenen =====
     memories: alle momentjes van dit "jaar", gesorteerd op datum.
     uptoMonth: 11 voor een afgesloten jaar; voor het lopende jaar de
     huidige maand — zo groeit de boom letterlijk met het jaar mee.
     interactive: blaadjes krijgen data-idx (voor strijken en openen). */
  function renderTree(group, memories, { uptoMonth = 11, interactive = false, leafScale = 1, seedBase = 0, growth = 1 } = {}) {
    group.innerHTML = '';

    // De boom groeit met de blaadjes mee: een jong jaar is een klein boompje.
    // Geankerd op de voet van de stam, zodat hij op de grond blijft staan.
    if (growth < 1) {
      const inner = document.createElementNS(NS, 'g');
      inner.setAttribute('transform', `translate(${(210 * (1 - growth)).toFixed(1)} ${(812 * (1 - growth)).toFixed(1)}) scale(${growth.toFixed(3)})`);
      group.appendChild(inner);
      group = inner;
    }

    const byMonth = new Map();
    memories.forEach((m, idx) => {
      const mo = new Date(m.date).getMonth();
      if (!byMonth.has(mo)) byMonth.set(mo, []);
      byMonth.get(mo).push({ mem: m, idx });
    });

    // Een jaar zonder momentjes is een jong scheutje, geen kale paal
    if (!memories.length) uptoMonth = Math.min(uptoMonth, 1);
    group.appendChild(mkPath(trunkPath(uptoMonth), 12));

    const leafNodes = [];
    for (let mo = 0; mo <= uptoMonth; mo++) {
      const entries = byMonth.get(mo) || [];
      // Lege maanden krijgen geen kale twijg (dat oogt doods); alleen de
      // huidige maand toont een verse groeitip.
      if (!entries.length && mo !== uptoMonth) continue;
      const twig = twigPath(mo);
      group.appendChild(mkPath(twig.d, 5));
      if (!entries.length) continue;

      // Meetlat langs de twijg; blaadjes groeien als een bos rónd de twijg
      // (twee rijen, wisselende hoeken) — nooit meer als rups erlangs
      const measure = mkPath(twig.d, 1);
      group.appendChild(measure);
      const total = measure.getTotalLength();
      const { rx, ry } = leafSize(entries.length);

      const rows = entries.length > 3 ? 2 : 1;
      const perRow = Math.ceil(entries.length / rows);
      const span = Math.min(total * 0.6, Math.max(rx * 1.3, perRow * rx * 1.15));
      const step = perRow > 1 ? span / (perRow - 1) : 0;

      entries.forEach(({ mem, idx }, i) => {
        const row = i % rows, k = Math.floor(i / rows);
        const along = Math.max(8, total - 8 - k * step - (row ? step * 0.5 : 0));
        const pt = measure.getPointAtLength(Math.min(along, total - 2));
        const ahead = measure.getPointAtLength(Math.max(0, Math.min(along + 4, total)));
        const angle = Math.atan2(ahead.y - pt.y, ahead.x - pt.x) * 180 / Math.PI;
        const side = rows === 1 ? (i % 2 ? 1 : -1) : (row ? 1 : -1);
        const spread = ry * (0.9 + rnd(seedBase + idx + 40) * 1.3);
        const off = side * spread;
        const leaf = makeLeaf({
          x: pt.x + (rnd(seedBase + idx + 90) * 4 - 2), y: pt.y + off,
          rot: angle + side * (22 + rnd(seedBase + idx) * 18) ,
          rx: rx * leafScale, ry: ry * leafScale,
          fill: leafColor(mem, i),
          goud: mem.isFavorite,
          seed: seedBase + idx * 7 + 3,
        });
        if (interactive) leaf.dataset.idx = String(idx);
        mem._pos = { x: pt.x, y: pt.y + off };
        group.appendChild(leaf);
        leafNodes.push(leaf);
      });
      measure.remove();
    }
    return leafNodes;
  }

  /* ===== Het bos: één mini-boom per jaar =====
     Nieuwste jaar vooraan rechts, oudere jaren erachter naar links. */
  const SLOTS = [
    { x: 288, ground: 712, s: 0.55 },
    { x: 140, ground: 682, s: 0.48 },
    { x: 46,  ground: 660, s: 0.4 },
    { x: 214, ground: 646, s: 0.34 },
    { x: 96,  ground: 636, s: 0.3 },
  ];

  function renderBos(svg, years) {
    svg.querySelectorAll('.jaar-groep, .jaar-label').forEach(el => el.remove());
    const shown = years.slice(-SLOTS.length);
    shown.forEach((yr, i) => {
      const slotIdx = shown.length - 1 - i; // nieuwste = slot 0 (vooraan)
      const slot = SLOTS[slotIdx];
      const g = document.createElementNS(NS, 'g');
      g.classList.add('jaar-groep', 'tree-hit');
      g.dataset.year = yr.key;
      // Anker op de voet van de stam (210, 812), dan schalen en plaatsen
      g.setAttribute('transform',
        `translate(${slot.x - 210 * slot.s} ${slot.ground - 812 * slot.s}) scale(${slot.s})`);
      renderTree(g, yr.memories, { uptoMonth: yr.uptoMonth, leafScale: 1.5, seedBase: i * 131, growth: yr.growth ?? 1 });
      // Aanraakvlak over de hele boom
      const hit = document.createElementNS(NS, 'rect');
      hit.setAttribute('x', 60); hit.setAttribute('y', 100);
      hit.setAttribute('width', 300); hit.setAttribute('height', 730);
      hit.setAttribute('fill', 'transparent');
      g.appendChild(hit);
      svg.appendChild(g);

      const label = document.createElementNS(NS, 'text');
      label.classList.add('jaar-label');
      label.setAttribute('x', slot.x);
      label.setAttribute('y', slot.ground + 30);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('fill', slotIdx === 0 ? '#54452F' : '#8D7C60');
      label.setAttribute('font-size', slotIdx === 0 ? 16 : 14);
      label.setAttribute('font-weight', 600);
      label.textContent = yr.label;
      svg.appendChild(label);
    });
  }

  /* Windvlaag: golf van geritsel door alles wat blaadje is */
  function breeze(root = document) {
    root.querySelectorAll('.leaf-inner').forEach(el => {
      const g = el.closest('.leaf');
      const x = g ? parseFloat(g.style.translate) || 0 : 0;
      setTimeout(() => {
        el.classList.add('gust');
        setTimeout(() => el.classList.remove('gust'), 1150);
      }, x * 1.7 + Math.random() * 200);
    });
  }

  return {
    renderTree, renderBos, breeze, SEASON, GOUD, seasonOf, leafColor,
    set colorMode(m) { colorMode = m; },
    get colorMode() { return colorMode; },
    set catColorOf(fn) { catColorOf = fn; },
  };
})();
