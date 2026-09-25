const express = require('express');
const { pool, withTransaction } = require('../db');
const { HttpError, newId, isValidDate, isValidTime, text, oneOf, arrayOf } = require('../lib/http');

const router = express.Router();

const CHECKIN_STATUSES = ['done', 'skipped'];

function validateMeal(m) {
  if (!m || typeof m !== 'object') throw new HttpError(400, 'refeição inválida');
  // Aceita "7:30" (planos salvos por versões antigas) e normaliza para "07:30".
  const time = typeof m.time === 'string' ? m.time.trim().padStart(5, '0') : m.time;
  if (!isValidTime(time)) throw new HttpError(400, 'time deve estar no formato HH:mm');
  return {
    id: m.id === undefined ? undefined : text(m.id, 'id', { max: 100 }),
    name: text(m.name, 'name', { max: 100 }),
    time,
    description: text(m.description, 'description', { max: 1000, optional: true }),
    items: arrayOf(m.items ?? [], 'items', { max: 50 }).map((i) => text(i, 'item', { max: 200 })),
    source: oneOf(m.source, 'source', ['pdf', 'manual'], { optional: true, fallback: 'manual' }),
  };
}

function validateExercise(e) {
  if (!e || typeof e !== 'object') throw new HttpError(400, 'exercício inválido');
  const num = (v, f) => {
    if (v === undefined || v === null) return undefined;
    if (!Number.isFinite(v) || v < 0 || v > 10000) throw new HttpError(400, `${f} inválido`);
    return v;
  };
  return {
    id: text(e.id, 'exercise.id', { max: 100, optional: true }) || undefined,
    name: text(e.name, 'exercise.name', { max: 100 }),
    sets: num(e.sets, 'sets'),
    reps: text(e.reps, 'reps', { max: 50, optional: true }) || undefined,
    load: text(e.load, 'load', { max: 50, optional: true }) || undefined,
    restSeconds: num(e.restSeconds, 'restSeconds'),
    notes: text(e.notes, 'notes', { max: 500, optional: true }) || undefined,
    videoId: text(e.videoId, 'videoId', { max: 100, optional: true }) || undefined,
  };
}

function validatePlan(p) {
  if (!p || typeof p !== 'object') throw new HttpError(400, 'ficha inválida');
  return {
    id: p.id === undefined ? undefined : text(p.id, 'id', { max: 100 }),
    name: text(p.name, 'name', { max: 100 }),
    dayLabel: text(p.dayLabel, 'dayLabel', { max: 50, optional: true }),
    exercises: arrayOf(p.exercises ?? [], 'exercises', { max: 60 }).map(validateExercise),
    source: oneOf(p.source, 'source', ['pdf', 'photo', 'manual'], { optional: true, fallback: 'manual' }),
  };
}

function validateCheckinBody(date, status) {
  if (!isValidDate(date)) throw new HttpError(400, 'date deve estar no formato AAAA-MM-DD');
  if (!CHECKIN_STATUSES.includes(status)) throw new HttpError(400, 'status inválido');
}

// ── Plano alimentar ───────────────────────────────────────
router.get('/meal-plan', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, name, time, description, items, source FROM meals WHERE user_id=$1 AND active=true ORDER BY time ASC',
    [req.userId]
  );
  res.json({ meals: rows });
});

router.post('/meal-plan', async (req, res) => {
  const meals = arrayOf(req.body.meals, 'meals', { max: 30 }).map(validateMeal);
  await withTransaction(async (db) => {
    // Atualiza as refeições que já existem e arquiva (active=false) as que saíram
    // do plano, em vez de apagar e recriar: apagar levava junto, via cascade,
    // todo o histórico de check-ins.
    const ids = [];
    for (const [i, m] of meals.entries()) {
      const id = m.id || newId('meal_');
      const { rowCount } = await db.query(
        `INSERT INTO meals (id, user_id, name, time, description, items, source, sort_order, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, time = EXCLUDED.time, description = EXCLUDED.description,
           items = EXCLUDED.items, source = EXCLUDED.source, sort_order = EXCLUDED.sort_order, active = true
         WHERE meals.user_id = EXCLUDED.user_id`,
        [id, req.userId, m.name, m.time, m.description, JSON.stringify(m.items), m.source, i]
      );
      // rowCount 0 = o id já pertence a outra conta.
      if (rowCount === 0) throw new HttpError(409, 'Conflito de identificador de refeição');
      ids.push(id);
    }
    await db.query(
      'UPDATE meals SET active=false WHERE user_id=$1 AND active=true AND NOT (id = ANY($2::text[]))',
      [req.userId, ids]
    );
  });
  res.json({ ok: true });
});

router.get('/meal-plan/checkins', async (req, res) => {
  const { date } = req.query;
  if (!date) throw new HttpError(400, 'date é obrigatório');
  const { rows } = await pool.query(
    'SELECT meal_id as "mealId", date, status, checked_at as "checkedAt" FROM meal_checkins WHERE user_id=$1 AND date=$2',
    [req.userId, date]
  );
  res.json({ checkins: rows.map(r => ({ ...r, checkedAt: r.checkedAt ? Number(r.checkedAt) : null })) });
});

router.post('/meal-plan/checkins', async (req, res) => {
  const { mealId, date, status } = req.body;
  if (!mealId || !date || !status) throw new HttpError(400, 'mealId, date e status são obrigatórios');
  validateCheckinBody(date, status);
  await withTransaction(async (db) => {
    // Só aceita check-in em refeição da própria conta (a FK composta no banco
    // garante o mesmo; aqui devolvemos um 404 claro em vez de erro 500).
    const { rows } = await db.query(
      'SELECT name, time, description, items FROM meals WHERE id=$1 AND user_id=$2',
      [mealId, req.userId]
    );
    const meal = rows[0];
    if (!meal) throw new HttpError(404, 'Refeição não encontrada');

    const checkedAt = Date.now();
    await db.query(
      `INSERT INTO meal_checkins (user_id, meal_id, date, status, checked_at) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (meal_id, date) DO UPDATE SET status=$4, checked_at=$5
       WHERE meal_checkins.user_id = EXCLUDED.user_id`,
      [req.userId, mealId, date, status, checkedAt]
    );

    // "Comi" também vira um dado extraído de nutrição, visível no Diário/Insights.
    // Marcar como "pulei" (ou re-marcar) remove o registro anterior via source_ref,
    // pra não duplicar/deixar lixo se o usuário alternar o status várias vezes.
    const sourceRef = `meal_checkin:${mealId}:${date}`;
    await db.query('DELETE FROM extracted_data WHERE user_id=$1 AND source_ref=$2', [req.userId, sourceRef]);
    if (status === 'done') {
      const value = meal.description
        || (Array.isArray(meal.items) && meal.items.length ? meal.items.join(', ') : 'Refeição registrada');
      await db.query(
        `INSERT INTO extracted_data (user_id, category, label, value, raw_text, timestamp, source_ref, source)
         VALUES ($1,'nutrition',$2,$3,$4,$5,$6,'meal_checkin')`,
        [req.userId, meal.name, value, `Marcado como feita no plano alimentar (${meal.time})`, checkedAt, sourceRef]
      );
    }
  });
  res.json({ ok: true });
});

// ── Fichas de treino ──────────────────────────────────────
router.get('/workout-plans', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, name, day_label as "dayLabel", exercises, source FROM workout_plans WHERE user_id=$1 AND active=true ORDER BY sort_order ASC',
    [req.userId]
  );
  res.json({ plans: rows });
});

router.post('/workout-plans', async (req, res) => {
  const plans = arrayOf(req.body.plans, 'plans', { max: 20 }).map(validatePlan);
  await withTransaction(async (db) => {
    // Mesmo esquema do plano alimentar: atualiza/insere e arquiva as fichas
    // removidas, preservando o histórico de check-ins.
    const ids = [];
    for (const [i, p] of plans.entries()) {
      const id = p.id || newId('wp_');
      const { rowCount } = await db.query(
        `INSERT INTO workout_plans (id, user_id, name, day_label, exercises, source, sort_order, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,true)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name, day_label = EXCLUDED.day_label, exercises = EXCLUDED.exercises,
           source = EXCLUDED.source, sort_order = EXCLUDED.sort_order, active = true
         WHERE workout_plans.user_id = EXCLUDED.user_id`,
        [id, req.userId, p.name, p.dayLabel, JSON.stringify(p.exercises), p.source, i]
      );
      if (rowCount === 0) throw new HttpError(409, 'Conflito de identificador de ficha');
      ids.push(id);
    }
    await db.query(
      'UPDATE workout_plans SET active=false WHERE user_id=$1 AND active=true AND NOT (id = ANY($2::text[]))',
      [req.userId, ids]
    );
  });
  res.json({ ok: true });
});

router.get('/workout-plans/checkins', async (req, res) => {
  const { date } = req.query;
  if (!date) throw new HttpError(400, 'date é obrigatório');
  const { rows } = await pool.query(
    'SELECT workout_plan_id as "workoutPlanId", date, status, checked_at as "checkedAt" FROM workout_checkins WHERE user_id=$1 AND date=$2',
    [req.userId, date]
  );
  res.json({ checkins: rows.map(r => ({ ...r, checkedAt: r.checkedAt ? Number(r.checkedAt) : null })) });
});

router.post('/workout-plans/checkins', async (req, res) => {
  const { workoutPlanId, date, status } = req.body;
  if (!workoutPlanId || !date || !status) throw new HttpError(400, 'workoutPlanId, date e status são obrigatórios');
  validateCheckinBody(date, status);
  await withTransaction(async (db) => {
    const { rows } = await db.query(
      'SELECT name, exercises FROM workout_plans WHERE id=$1 AND user_id=$2',
      [workoutPlanId, req.userId]
    );
    const plan = rows[0];
    if (!plan) throw new HttpError(404, 'Ficha de treino não encontrada');

    const checkedAt = Date.now();
    await db.query(
      `INSERT INTO workout_checkins (user_id, workout_plan_id, date, status, checked_at) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (workout_plan_id, date) DO UPDATE SET status=$4, checked_at=$5
       WHERE workout_checkins.user_id = EXCLUDED.user_id`,
      [req.userId, workoutPlanId, date, status, checkedAt]
    );

    // "Concluí o treino" também vira um dado extraído (category: workout), visível no
    // Diário/Insights e que já alimenta a conquista "10 treinos" existente. Mesmo
    // truque de source_ref do check-in de refeição, pra não duplicar/deixar lixo se
    // o usuário alternar o status várias vezes.
    const sourceRef = `workout_checkin:${workoutPlanId}:${date}`;
    await db.query('DELETE FROM extracted_data WHERE user_id=$1 AND source_ref=$2', [req.userId, sourceRef]);
    if (status === 'done') {
      const exerciseNames = Array.isArray(plan.exercises) ? plan.exercises.map(e => e.name).filter(Boolean) : [];
      const value = exerciseNames.length ? exerciseNames.join(', ') : 'Treino registrado';
      await db.query(
        `INSERT INTO extracted_data (user_id, category, label, value, raw_text, timestamp, source_ref, source)
         VALUES ($1,'workout',$2,$3,$4,$5,$6,'workout_checkin')`,
        [req.userId, plan.name, value, 'Marcado como concluído na ficha de treino', checkedAt, sourceRef]
      );
    }
  });
  res.json({ ok: true });
});

module.exports = router;
