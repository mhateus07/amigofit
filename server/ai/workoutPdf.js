// Leitura de fichas de treino em PDF pelo LAYOUT da página, sem IA: posição
// de cada linha de texto e de cada imagem. Feito para fichas no formato
// "título do exercício / Séries: / Carga: / Intervalo:" com uma foto por
// exercício (ex.: fichas geradas por apps de personal trainer). É instantâneo,
// não custa nada e preserva o texto do personal. Se o PDF não tiver esse
// formato, devolve null e quem chamou cai na extração por IA.

// ── Parser de texto (puro, testável) ─────────────────────
const FIELD_RE = /^(s[ée]ries|carga|intervalo|descanso|obs(?:erva[çc][ãa]o)?)\s*:\s*(.*)$/i;

function cleanText(s) {
  // Remove ícones de fonte (área de uso privado do Unicode), o marcador de
  // imagem U+FFFC que o PDFKit do iPhone põe no lugar das fotos, e espaços extras.
  return s.replace(/[\uE000-\uF8FF\uFFFC]/g, '').replace(/\s+/g, ' ').trim();
}

function parseRest(value) {
  const v = value.toLowerCase();
  // "2 min", "1,5min", "1min30" (1 minuto e 30 segundos)
  const min = v.match(/(\d+(?:[.,]\d+)?)\s*min[a-z]*\s*(\d+)?/);
  if (min) return Math.round(parseFloat(min[1].replace(',', '.')) * 60) + (min[2] ? parseInt(min[2], 10) : 0);
  const sec = v.match(/(\d+)\s*(s|seg|”|"|'')?/);
  return sec ? parseInt(sec[1], 10) : undefined;
}

// "4x 10 a 12 rep. RESTPAUSE na última série (Pegada semi-pronada)"
//   → sets 4, reps "10 a 12", notes "RESTPAUSE na última série · Pegada semi-pronada"
function parseSeries(value) {
  const notes = [];
  let rest = value.replace(/\(([^)]*)\)/g, (_, inner) => { notes.push(inner.trim()); return ' '; });
  let sets;
  const m = rest.match(/^\s*(\d+)\s*x\s*(.*)$/i);
  if (m) { sets = parseInt(m[1], 10); rest = m[2]; }
  // Frase nova (começa com maiúscula) depois de "rep." vira observação.
  const parts = rest.split(/\.\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ])/);
  let reps = parts.shift().trim();
  parts.forEach((p) => notes.push(p.replace(/\.$/, '').trim()));
  // Técnica em maiúsculas no meio das repetições ("12 rep DROPSET na última série").
  const technique = reps.match(/\s([A-ZÁÉÍÓÚ-]{4,}\b.*)$/);
  if (technique) {
    notes.push(technique[1].replace(/\.$/, '').trim());
    reps = reps.slice(0, technique.index);
  }
  reps = reps.replace(/\brep(s)?\b\.?/gi, '').replace(/\s+/g, ' ').replace(/\s*\.$/, '').trim();
  return { sets, reps: reps || undefined, notes: notes.filter(Boolean) };
}

function parseLoad(value) {
  const v = value.trim();
  // "0kg" = sem carga externa (peso corporal/mobilidade).
  if (!v || /^0\s*kg$/i.test(v)) return undefined;
  return v;
}

/**
 * @param lines [{ text, x, y, page }] em ordem de leitura (página, y decrescente)
 * @returns { routine, planName, exercises: [{ name, sets, reps, load, restSeconds, notes, page, top, bottom }] }
 */
function parseWorkoutLines(lines) {
  let routine = null;
  let planName = null;
  const exercises = [];
  let current = null;
  let lastField = null;
  let prev = null;

  for (const line of lines) {
    const text = cleanText(line.text);
    if (!text) continue;
    const rotina = text.match(/^rotina\s*:\s*(.+)$/i);
    if (rotina) { routine = rotina[1].trim(); prev = line; continue; }

    const field = text.match(FIELD_RE);
    const gap = prev && prev.page === line.page ? prev.y - line.y : Infinity;

    if (field && current) {
      const key = field[1].toLowerCase();
      lastField = key.startsWith('s') ? 'series' : key.startsWith('c') ? 'load' : key.startsWith('o') ? 'notes' : 'rest';
      current.fields[lastField] = field[2].trim();
      current.bottom = line.y;
    } else if (!field && current && gap < 24) {
      // Linha colada à anterior: continuação do título ou do último campo
      // (palavra hifenizada na quebra de linha é juntada sem espaço).
      const join = (a) => (/-$/.test(a) ? a + text : `${a} ${text}`);
      if (lastField) current.fields[lastField] = join(current.fields[lastField]);
      else current.name = join(current.name);
      current.bottom = line.y;
    } else if (!field) {
      if (!planName && exercises.length === 0 && !current) {
        // Cabeçalho: nome do aluno, objetivo e nível ficam à direita da foto
        // de perfil; o nome da ficha ("H2- A") é a primeira linha à esquerda.
        if (routine && line.x < 40) planName = text;
        prev = line;
        continue;
      }
      current = { name: text, fields: {}, page: line.page, top: line.y, bottom: line.y };
      exercises.push(current);
      lastField = null;
    }
    prev = line;
  }

  return {
    routine,
    planName,
    exercises: exercises
      .filter((e) => Object.keys(e.fields).length > 0)
      .map((e) => {
        const series = e.fields.series ? parseSeries(e.fields.series) : { notes: [] };
        const notes = [...series.notes];
        if (e.fields.notes) notes.push(e.fields.notes);
        return {
          name: cleanText(e.name),
          sets: series.sets,
          reps: series.reps,
          load: e.fields.load ? parseLoad(e.fields.load) : undefined,
          restSeconds: e.fields.rest ? parseRest(e.fields.rest) : undefined,
          notes: notes.length ? notes.join(' · ') : undefined,
          page: e.page,
          top: e.top,
          bottom: e.bottom,
        };
      }),
  };
}

// Associa cada imagem ao exercício cujo bloco (do título até o próximo
// título) contém o centro vertical da imagem. Imagens acima do primeiro
// exercício (foto de perfil do cabeçalho) ficam de fora.
function assignImages(exercises, images) {
  const byExercise = new Map();
  for (const img of images) {
    const center = (img.y0 + img.y1) / 2;
    const candidates = exercises
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e.page === img.page && e.top + 20 >= center);
    if (!candidates.length) continue;
    const { i } = candidates[candidates.length - 1];
    const exercise = exercises[i];
    const nextTop = exercises[i + 1] && exercises[i + 1].page === img.page ? exercises[i + 1].top : -Infinity;
    if (center > nextTop && !byExercise.has(i) && center <= exercise.top + 20) byExercise.set(i, img);
  }
  return byExercise;
}

// ── Leitura do PDF (pdfjs + canvas) ──────────────────────
const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];

function groupLines(items, page) {
  const rows = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const x = it.transform[4];
    const y = it.transform[5];
    let row = rows.find((r) => Math.abs(r.y - y) < 2);
    if (!row) { row = { y, page, parts: [] }; rows.push(row); }
    row.parts.push({ x, end: x + (it.width || 0), str: it.str });
  }
  return rows.map((r) => {
    r.parts.sort((a, b) => a.x - b.x);
    let text = '';
    let lastEnd = null;
    for (const p of r.parts) {
      if (lastEnd !== null && p.x - lastEnd > 1.5) text += ' ';
      text += p.str;
      lastEnd = p.end;
    }
    return { text, x: r.parts[0].x, y: r.y, page };
  }).sort((a, b) => b.y - a.y);
}

const IMAGE_SCALE = 6; // miniaturas de ~46x82pt viram ~275x490px

async function extractWorkoutFromPdfLayout(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { createCanvas } = require('@napi-rs/canvas');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), verbosity: 0 }).promise;
  try {
    const lines = [];
    const images = [];
    const pages = [];
    for (let p = 1; p <= Math.min(doc.numPages, 10); p++) {
      const page = await doc.getPage(p);
      pages[p] = page;
      lines.push(...groupLines((await page.getTextContent()).items, p));
      const ops = await page.getOperatorList();
      let ctm = [1, 0, 0, 1, 0, 0];
      const stack = [];
      for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i];
        const args = ops.argsArray[i];
        if (fn === pdfjs.OPS.save) stack.push(ctm);
        else if (fn === pdfjs.OPS.restore) ctm = stack.pop() || ctm;
        else if (fn === pdfjs.OPS.transform) ctm = mul(ctm, args);
        else if (fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintInlineImageXObject) {
          // Caixa da imagem na página (também para fotos giradas).
          const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => [ctm[0] * u + ctm[2] * v + ctm[4], ctm[1] * u + ctm[3] * v + ctm[5]]);
          const xs = pts.map((q) => q[0]);
          const ys = pts.map((q) => q[1]);
          const box = { page: p, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
          if (box.x1 - box.x0 > 20 && box.y1 - box.y0 > 20) images.push(box);
        }
      }
    }

    const parsed = parseWorkoutLines(lines);
    if (parsed.exercises.length === 0) return null;

    // Recorta a foto de cada exercício da página renderizada — assim ela sai
    // exatamente como aparece no PDF (recorte e rotação já aplicados).
    const assigned = assignImages(parsed.exercises, images);
    const photos = new Map();
    const rendered = new Map();
    for (const [index, box] of assigned) {
      const page = pages[box.page];
      if (!rendered.has(box.page)) {
        const viewport = page.getViewport({ scale: IMAGE_SCALE });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        rendered.set(box.page, { canvas, height: page.getViewport({ scale: 1 }).height });
      }
      const { canvas, height } = rendered.get(box.page);
      const sw = Math.round((box.x1 - box.x0) * IMAGE_SCALE);
      const sh = Math.round((box.y1 - box.y0) * IMAGE_SCALE);
      const crop = createCanvas(sw, sh);
      crop.getContext('2d').drawImage(canvas, box.x0 * IMAGE_SCALE, (height - box.y1) * IMAGE_SCALE, sw, sh, 0, 0, sw, sh);
      photos.set(index, await crop.encode('jpeg', 82));
    }

    const letter = parsed.planName && parsed.planName.match(/([A-Z])\s*$/);
    return {
      routine: parsed.routine,
      plan: {
        name: letter ? `Treino ${letter[1]}` : (parsed.planName || 'Treino'),
        dayLabel: parsed.planName || null,
        exercises: parsed.exercises.map((e, i) => ({
          name: e.name.slice(0, 100),
          sets: e.sets,
          reps: e.reps ? e.reps.slice(0, 50) : undefined,
          load: e.load ? e.load.slice(0, 50) : undefined,
          restSeconds: e.restSeconds,
          notes: e.notes ? e.notes.slice(0, 500) : undefined,
          photo: photos.get(i) || null,
        })),
      },
    };
  } finally {
    await doc.destroy();
  }
}

// Ficha a partir das linhas de texto lidas no próprio aparelho (PDFKit no
// iPhone): só ~5 KB sobem, em vez do PDF de dezenas de MB. Sem fotos.
function workoutFromLines(rawLines) {
  const lines = rawLines
    .filter((l) => l && typeof l.text === 'string' && Number.isFinite(l.x) && Number.isFinite(l.y))
    .map((l) => ({ text: l.text, x: l.x, y: l.y, page: Number.isInteger(l.page) ? l.page : 1 }))
    .sort((a, b) => a.page - b.page || b.y - a.y);
  const parsed = parseWorkoutLines(lines);
  if (parsed.exercises.length === 0) return null;
  const letter = parsed.planName && parsed.planName.match(/([A-Z])\s*$/);
  return {
    name: letter ? `Treino ${letter[1]}` : (parsed.planName || 'Treino'),
    dayLabel: parsed.planName || null,
    routine: parsed.routine || null,
    exercises: parsed.exercises.map((e) => ({
      name: e.name.slice(0, 100),
      sets: e.sets,
      reps: e.reps ? e.reps.slice(0, 50) : undefined,
      load: e.load ? e.load.slice(0, 50) : undefined,
      restSeconds: e.restSeconds,
      notes: e.notes ? e.notes.slice(0, 500) : undefined,
    })),
  };
}

module.exports = { extractWorkoutFromPdfLayout, workoutFromLines, parseWorkoutLines, parseSeries, parseRest, assignImages };
