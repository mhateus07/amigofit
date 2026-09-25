const express = require('express');
const { pool, withTransaction } = require('../db');
const { HttpError, isValidDate, text, arrayOf } = require('../lib/http');

// Séries realizadas: carga e repetições de cada série feita, por exercício e
// dia. Base para a evolução de carga ao longo do tempo.
const router = express.Router();

function toClient(r) {
  return {
    workoutPlanId: r.workout_plan_id,
    exerciseId: r.exercise_id,
    exerciseName: r.exercise_name,
    date: r.date,
    setIndex: r.set_index,
    reps: r.reps,
    loadKg: r.load_kg === null ? null : Number(r.load_kg),
  };
}

function validateSet(set) {
  if (!set || typeof set !== 'object') throw new HttpError(400, 'série inválida');
  const reps = set.reps ?? null;
  const loadKg = set.loadKg ?? null;
  if (reps !== null && (!Number.isInteger(reps) || reps < 0 || reps > 1000)) throw new HttpError(400, 'reps inválido');
  if (loadKg !== null && (!Number.isFinite(loadKg) || loadKg < 0 || loadKg > 2000)) throw new HttpError(400, 'loadKg inválido');
  return { reps, loadKg };
}

router.get('/', async (req, res) => {
  const { date, workoutPlanId } = req.query;
  if (!isValidDate(date)) throw new HttpError(400, 'date deve estar no formato AAAA-MM-DD');
  const { rows } = await pool.query(
    `SELECT workout_plan_id, exercise_id, exercise_name, date, set_index, reps, load_kg
     FROM workout_set_logs
     WHERE user_id=$1 AND date=$2 AND ($3::text IS NULL OR workout_plan_id=$3)
     ORDER BY exercise_id, set_index`,
    [req.userId, date, workoutPlanId || null]
  );
  res.json({ sets: rows.map(toClient) });
});

// Substitui as séries de um exercício naquele dia (idempotente).
router.put('/', async (req, res) => {
  const { workoutPlanId, date } = req.body || {};
  const exerciseId = text(req.body?.exerciseId, 'exerciseId', { max: 120 });
  const exerciseName = text(req.body?.exerciseName, 'exerciseName', { max: 100 });
  if (!isValidDate(date)) throw new HttpError(400, 'date deve estar no formato AAAA-MM-DD');
  const sets = arrayOf(req.body?.sets, 'sets', { max: 30 }).map(validateSet);

  await withTransaction(async (db) => {
    const owned = await db.query('SELECT 1 FROM workout_plans WHERE id=$1 AND user_id=$2', [workoutPlanId, req.userId]);
    if (!owned.rowCount) throw new HttpError(404, 'Ficha de treino não encontrada');
    await db.query(
      'DELETE FROM workout_set_logs WHERE user_id=$1 AND workout_plan_id=$2 AND exercise_id=$3 AND date=$4',
      [req.userId, workoutPlanId, exerciseId, date]
    );
    const now = Date.now();
    for (const [i, set] of sets.entries()) {
      await db.query(
        `INSERT INTO workout_set_logs
           (user_id, workout_plan_id, exercise_id, exercise_name, date, set_index, reps, load_kg, completed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [req.userId, workoutPlanId, exerciseId, exerciseName, date, i, set.reps, set.loadKg, now]
      );
    }
  });
  res.json({ ok: true });
});

// Evolução de um exercício: por dia, maior carga, repetições nela e volume.
router.get('/history', async (req, res) => {
  const exercise = text(req.query.exercise, 'exercise', { max: 100 });
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 12, 1), 100);
  const { rows } = await pool.query(
    `SELECT date,
            MAX(load_kg) AS max_load,
            COUNT(*)::int AS sets,
            COALESCE(SUM(reps), 0)::int AS total_reps,
            COALESCE(SUM(reps * load_kg), 0) AS volume,
            (ARRAY_AGG(reps ORDER BY load_kg DESC NULLS LAST, reps DESC NULLS LAST))[1] AS reps_at_max
     FROM workout_set_logs
     WHERE user_id=$1 AND lower(exercise_name) = lower($2)
     GROUP BY date
     ORDER BY date DESC
     LIMIT $3`,
    [req.userId, exercise, limit]
  );
  res.json({
    history: rows.map((r) => ({
      date: r.date,
      maxLoadKg: r.max_load === null ? null : Number(r.max_load),
      repsAtMax: r.reps_at_max,
      sets: r.sets,
      totalReps: r.total_reps,
      volumeKg: Number(r.volume),
    })),
  });
});

module.exports = router;
