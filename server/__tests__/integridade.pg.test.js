/**
 * @jest-environment node
 */
// Testes contra um PostgreSQL real: histórico preservado, isolamento entre
// contas e concorrência. Os demais testes do backend usam pg mockado.
process.env.JWT_SECRET = 'test_secret_only_for_jest';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { startRealDb } = require('../testing/realDb');

jest.setTimeout(60000);

let db;
let app;
let pool;
let initDB;

function tokenFor(userId) {
  return `Bearer ${jwt.sign({ userId, name: userId }, process.env.JWT_SECRET, { expiresIn: '1h' })}`;
}
const A = tokenFor('u_a');
const B = tokenFor('u_b');

beforeAll(async () => {
  db = await startRealDb();
  ({ app, pool, initDB } = require('../index'));
  await initDB();
  await pool.query(`INSERT INTO users (id, name, email, password_hash) VALUES
    ('u_a','A','a@x.com','h'), ('u_b','B','b@x.com','h')`);
});

afterAll(async () => {
  await pool.end();
  await db.stop();
});

beforeEach(async () => {
  await pool.query(`TRUNCATE meal_checkins, workout_checkins, extracted_data, messages, meals, workout_plans RESTART IDENTITY`);
});

describe('migrações', () => {
  it('são idempotentes (rodar de novo não falha nem reaplica)', async () => {
    await initDB();
    const { rows } = await pool.query('SELECT id FROM schema_migrations ORDER BY id');
    expect(rows.map((r) => r.id)).toEqual(expect.arrayContaining([1, 2]));
  });
});

describe('migração de um banco no formato atual de produção', () => {
  it('preserva os dados existentes e troca a FK em cascade pela FK com dono', async () => {
    const { Pool } = require('pg');
    const { MIGRATIONS, runMigrations } = require('../migrations');
    await pool.query('DROP DATABASE IF EXISTS legado');
    await pool.query('CREATE DATABASE legado');
    const legacy = new Pool({
      host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER,
      password: process.env.DB_PASSWORD, database: 'legado',
    });
    try {
      // Produção hoje: schema criado sem schema_migrations, com dados.
      await legacy.query(MIGRATIONS[0].sql);
      await legacy.query(`INSERT INTO users (id, name, email, password_hash) VALUES ('u_a','A','a@x.com','h')`);
      await legacy.query(`INSERT INTO meals (id, user_id, name, time) VALUES ('m1','u_a','Almoço','12:00')`);
      await legacy.query(`INSERT INTO meal_checkins (user_id, meal_id, date, status) VALUES ('u_a','m1','2026-09-01','done')`);

      await runMigrations(legacy);

      const checkins = await legacy.query('SELECT meal_id FROM meal_checkins');
      expect(checkins.rows).toEqual([{ meal_id: 'm1' }]);
      const fks = await legacy.query(
        `SELECT conname FROM pg_constraint WHERE conrelid = 'meal_checkins'::regclass AND contype = 'f' ORDER BY conname`
      );
      expect(fks.rows.map((r) => r.conname)).toEqual(['meal_checkins_meal_owner_fkey', 'meal_checkins_user_id_fkey']);
      // Sem cascade: apagar a refeição com histórico é bloqueado pelo banco.
      await expect(legacy.query(`DELETE FROM meals WHERE id='m1'`)).rejects.toThrow(/foreign key/);
    } finally {
      await legacy.end();
    }
  });
});

describe('plano alimentar preserva histórico', () => {
  it('editar o plano mantém os check-ins anteriores', async () => {
    await request(app).post('/api/meal-plan').set('Authorization', A)
      .send({ meals: [{ id: 'm1', name: 'Almoço', time: '12:00', items: [] }, { id: 'm2', name: 'Jantar', time: '19:00', items: [] }] })
      .expect(200);
    await request(app).post('/api/meal-plan/checkins').set('Authorization', A)
      .send({ mealId: 'm1', date: '2026-09-20', status: 'done' }).expect(200);
    await request(app).post('/api/meal-plan/checkins').set('Authorization', A)
      .send({ mealId: 'm2', date: '2026-09-20', status: 'skipped' }).expect(200);

    // Edita m1 e remove m2 do plano.
    await request(app).post('/api/meal-plan').set('Authorization', A)
      .send({ meals: [{ id: 'm1', name: 'Almoço leve', time: '12:30', items: [] }] })
      .expect(200);

    const { rows } = await pool.query('SELECT meal_id, status FROM meal_checkins ORDER BY meal_id');
    expect(rows).toEqual([{ meal_id: 'm1', status: 'done' }, { meal_id: 'm2', status: 'skipped' }]);

    const plan = await request(app).get('/api/meal-plan').set('Authorization', A).expect(200);
    expect(plan.body.meals.map((m) => [m.id, m.name])).toEqual([['m1', 'Almoço leve']]);
    const archived = await pool.query("SELECT active FROM meals WHERE id='m2'");
    expect(archived.rows[0].active).toBe(false);
  });

  it('reincluir uma refeição arquivada reativa ela', async () => {
    await request(app).post('/api/meal-plan').set('Authorization', A)
      .send({ meals: [{ id: 'm1', name: 'Almoço', time: '12:00' }] }).expect(200);
    await request(app).post('/api/meal-plan').set('Authorization', A).send({ meals: [] }).expect(200);
    await request(app).post('/api/meal-plan').set('Authorization', A)
      .send({ meals: [{ id: 'm1', name: 'Almoço', time: '12:00' }] }).expect(200);
    const plan = await request(app).get('/api/meal-plan').set('Authorization', A);
    expect(plan.body.meals).toHaveLength(1);
  });
});

describe('fichas de treino preservam histórico', () => {
  it('editar as fichas mantém os check-ins anteriores', async () => {
    await request(app).post('/api/workout-plans').set('Authorization', A)
      .send({ plans: [{ id: 'w1', name: 'Treino A', exercises: [{ name: 'Supino' }] }] }).expect(200);
    await request(app).post('/api/workout-plans/checkins').set('Authorization', A)
      .send({ workoutPlanId: 'w1', date: '2026-09-20', status: 'done' }).expect(200);
    await request(app).post('/api/workout-plans').set('Authorization', A)
      .send({ plans: [{ id: 'w1', name: 'Treino A2', exercises: [] }] }).expect(200);
    await request(app).post('/api/workout-plans').set('Authorization', A).send({ plans: [] }).expect(200);

    const { rows } = await pool.query('SELECT workout_plan_id, status FROM workout_checkins');
    expect(rows).toEqual([{ workout_plan_id: 'w1', status: 'done' }]);
  });
});

describe('isolamento entre contas', () => {
  it('check-in em refeição de outra conta é recusado', async () => {
    await request(app).post('/api/meal-plan').set('Authorization', A)
      .send({ meals: [{ id: 'm1', name: 'Almoço', time: '12:00' }] }).expect(200);
    await request(app).post('/api/meal-plan/checkins').set('Authorization', A)
      .send({ mealId: 'm1', date: '2026-09-20', status: 'done' }).expect(200);

    await request(app).post('/api/meal-plan/checkins').set('Authorization', B)
      .send({ mealId: 'm1', date: '2026-09-20', status: 'skipped' }).expect(404);

    const { rows } = await pool.query('SELECT user_id, status FROM meal_checkins');
    expect(rows).toEqual([{ user_id: 'u_a', status: 'done' }]);
  });

  it('o banco recusa check-in cruzado mesmo sem passar pela API', async () => {
    await pool.query(`INSERT INTO meals (id, user_id, name, time) VALUES ('m1','u_a','Almoço','12:00')`);
    await expect(pool.query(
      `INSERT INTO meal_checkins (user_id, meal_id, date, status) VALUES ('u_b','m1','2026-09-20','done')`
    )).rejects.toThrow(/foreign key/);
  });

  it('check-in em ficha de outra conta é recusado', async () => {
    await request(app).post('/api/workout-plans').set('Authorization', A)
      .send({ plans: [{ id: 'w1', name: 'Treino A', exercises: [] }] }).expect(200);
    await request(app).post('/api/workout-plans/checkins').set('Authorization', B)
      .send({ workoutPlanId: 'w1', date: '2026-09-20', status: 'done' }).expect(404);
  });

  it('salvar plano com id de refeição de outra conta não altera a refeição dela', async () => {
    await request(app).post('/api/meal-plan').set('Authorization', A)
      .send({ meals: [{ id: 'm1', name: 'Almoço', time: '12:00' }] }).expect(200);
    await request(app).post('/api/meal-plan').set('Authorization', B)
      .send({ meals: [{ id: 'm1', name: 'Invadido', time: '00:00' }] }).expect(409);
    const { rows } = await pool.query("SELECT user_id, name FROM meals WHERE id='m1'");
    expect(rows).toEqual([{ user_id: 'u_a', name: 'Almoço' }]);
  });

  it('mensagem com id de outra conta não é sobrescrita', async () => {
    const msg = { role: 'user', content: 'meu segredo', timestamp: 1 };
    await request(app).put('/api/messages/msg1').set('Authorization', A).send(msg).expect(200);
    await request(app).put('/api/messages/msg1').set('Authorization', B)
      .send({ ...msg, content: 'sobrescrito' }).expect(409);
    await request(app).post('/api/messages').set('Authorization', B)
      .send({ messages: [{ ...msg, id: 'msg1', content: 'sobrescrito' }] }).expect(409);

    const { rows } = await pool.query("SELECT user_id, content FROM messages WHERE id='msg1'");
    expect(rows).toEqual([{ user_id: 'u_a', content: 'meu segredo' }]);
    const bList = await request(app).get('/api/messages').set('Authorization', B);
    expect(bList.body.messages).toEqual([]);
  });

  it('limpar histórico de uma conta não afeta a outra', async () => {
    await request(app).put('/api/messages/a1').set('Authorization', A).send({ role: 'user', content: 'a', timestamp: 1 });
    await request(app).put('/api/messages/b1').set('Authorization', B).send({ role: 'user', content: 'b', timestamp: 1 });
    await request(app).delete('/api/messages').set('Authorization', A).expect(200);
    const { rows } = await pool.query('SELECT id FROM messages');
    expect(rows).toEqual([{ id: 'b1' }]);
  });
});

describe('mensagens', () => {
  it('gravações concorrentes de dois aparelhos não apagam mensagens', async () => {
    // Aparelho 1 e 2 salvam mensagens diferentes ao mesmo tempo.
    await Promise.all([
      request(app).put('/api/messages/d1').set('Authorization', A).send({ role: 'user', content: 'um', timestamp: 1 }),
      request(app).put('/api/messages/d2').set('Authorization', A).send({ role: 'user', content: 'dois', timestamp: 2 }),
      // Cliente antigo mandando uma lista incompleta: não apaga mais nada.
      request(app).post('/api/messages').set('Authorization', A).send({ messages: [{ id: 'd3', role: 'assistant', content: 'três', timestamp: 3 }] }),
    ]);
    const res = await request(app).get('/api/messages').set('Authorization', A);
    expect(res.body.messages.map((m) => m.id)).toEqual(['d1', 'd2', 'd3']);
  });

  it('paginação devolve as mais recentes em ordem cronológica', async () => {
    for (let i = 1; i <= 5; i++) {
      await request(app).put(`/api/messages/p${i}`).set('Authorization', A).send({ role: 'user', content: `${i}`, timestamp: i });
    }
    const page1 = await request(app).get('/api/messages?limit=2').set('Authorization', A);
    expect(page1.body.messages.map((m) => m.id)).toEqual(['p4', 'p5']);
    expect(page1.body.hasMore).toBe(true);
    const page2 = await request(app).get('/api/messages?limit=10&before=4').set('Authorization', A);
    expect(page2.body.messages.map((m) => m.id)).toEqual(['p1', 'p2', 'p3']);
    expect(page2.body.hasMore).toBe(false);
  });

  it('rejeita mensagem inválida', async () => {
    await request(app).put('/api/messages/x').set('Authorization', A).send({ role: 'system', content: 'x', timestamp: 1 }).expect(400);
  });
});
