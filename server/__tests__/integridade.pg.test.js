/**
 * @jest-environment node
 */
// Testes contra um PostgreSQL real: histórico preservado, isolamento entre
// contas e concorrência. Os demais testes do backend usam pg mockado.
process.env.JWT_SECRET = 'test_secret_only_for_jest';
process.env.AI_KEYS_SECRET = 'segredo-de-teste-com-mais-de-32-caracteres';
process.env.NODE_ENV = 'test';
process.env.UPLOAD_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'amigofit-up-')) + '/exercise-videos';

// O leitor de layout usa pdfjs (ESM), que o Jest deste projeto não carrega;
// ele tem testes próprios (workoutPdf.test.js) e foi validado nos PDFs reais.
jest.mock('../ai/workoutPdf', () => ({
  extractWorkoutFromPdfLayout: jest.fn(async () => ({
    routine: 'Hipertrofia 02',
    plan: {
      name: 'Treino B',
      dayLabel: 'H2- B',
      exercises: [
        { name: 'Desenvolvimento c/ barra pronta', sets: 3, reps: '10-6-6', load: '22/26Kg', restSeconds: 90, photo: Buffer.from('jpeg-1') },
        { name: 'Tríceps puxador corda', sets: 3, reps: '12', load: '41kg', restSeconds: 90, photo: null },
      ],
    },
  })),
}));

jest.mock('@anthropic-ai/sdk', () => {
  const mCreate = jest.fn();
  const MockAnthropic = jest.fn().mockImplementation(() => ({ messages: { create: mCreate } }));
  MockAnthropic.__mockCreate = mCreate;
  return MockAnthropic;
});

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
  await pool.query(`TRUNCATE meal_checkins, workout_checkins, workout_set_logs, exercise_images, extracted_data, messages, meals, workout_plans, ai_keys, profiles, chat_images RESTART IDENTITY`);
});

describe('migrações', () => {
  it('são idempotentes (rodar de novo não falha nem reaplica)', async () => {
    await initDB();
    const { rows } = await pool.query('SELECT id FROM schema_migrations ORDER BY id');
    expect(rows.map((r) => r.id)).toEqual(expect.arrayContaining([1, 2, 3, 4, 5]));
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

describe('chaves de IA', () => {
  it('ficam criptografadas no banco e a API só devolve os 4 últimos caracteres', async () => {
    const res = await request(app).put('/api/ai-keys/anthropic').set('Authorization', A)
      .send({ apiKey: 'sk-ant-segredo-1234' }).expect(200);
    expect(res.body.keys).toEqual({ anthropic: { last4: '1234' } });
    const { rows } = await pool.query('SELECT secret FROM ai_keys');
    expect(rows[0].secret).not.toContain('segredo');
    const profile = await request(app).get('/api/ai-keys').set('Authorization', A);
    expect(JSON.stringify(profile.body)).not.toContain('segredo');
  });

  it('o servidor usa a chave salva quando o app não envia x-api-key', async () => {
    const Anthropic = require('@anthropic-ai/sdk');
    Anthropic.__mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: 'oi!' }] });
    await request(app).put('/api/ai-keys/anthropic').set('Authorization', A).send({ apiKey: 'sk-ant-segredo-1234' });
    const res = await request(app).post('/api/chat').set('Authorization', A)
      .send({ messages: [{ role: 'user', content: 'olá' }], systemPrompt: 'x' }).expect(200);
    expect(res.body.text).toBe('oi!');
    expect(Anthropic).toHaveBeenLastCalledWith(expect.objectContaining({ apiKey: 'sk-ant-segredo-1234' }));
  });

  it('sem chave salva nem enviada, a IA responde 401', async () => {
    await request(app).post('/api/chat').set('Authorization', B)
      .send({ messages: [{ role: 'user', content: 'olá' }], systemPrompt: 'x' }).expect(401);
  });

  it('chaves antigas em texto puro no perfil são migradas e removidas do JSON', async () => {
    await pool.query(`INSERT INTO profiles (user_id, data) VALUES ('u_a', $1)`,
      [JSON.stringify({ name: 'A', aiProvider: 'groq', aiApiKeys: { groq: 'gsk_antiga_9876', openai: '' } })]);
    await initDB();
    const { rows } = await pool.query("SELECT data FROM profiles WHERE user_id='u_a'");
    expect(rows[0].data.aiApiKeys).toBeUndefined();
    const keys = await request(app).get('/api/ai-keys').set('Authorization', A);
    expect(keys.body.keys).toEqual({ groq: { last4: '9876' } });
  });
});

describe('perfil', () => {
  it('salvar parte dos campos não apaga os outros e descarta chaves enviadas no perfil', async () => {
    await request(app).post('/api/profile').set('Authorization', A)
      .send({ name: 'A', goal: 'health', level: 'beginner', onboardingComplete: true, aiProvider: 'groq' }).expect(200);
    await request(app).post('/api/profile').set('Authorization', A)
      .send({ name: 'A2', aiApiKeys: { groq: 'gsk_vazada' } }).expect(200);
    const res = await request(app).get('/api/profile').set('Authorization', A);
    expect(res.body.profile).toEqual({ name: 'A2', goal: 'health', level: 'beginner', onboardingComplete: true, aiProvider: 'groq' });
  });

  it('rejeita valores inválidos', async () => {
    await request(app).post('/api/profile').set('Authorization', A).send({ goal: 'voar' }).expect(400);
  });
});

describe('diário', () => {
  it('sincronizar de novo com o mesmo sourceRef atualiza em vez de duplicar', async () => {
    const item = { category: 'performance', label: 'Passos', value: '3.000 passos', timestamp: 1, source: 'apple_health', sourceRef: 'apple_health:steps:2026-09-20' };
    await request(app).post('/api/extracted-data').set('Authorization', A).send({ data: [item] }).expect(200);
    await request(app).post('/api/extracted-data').set('Authorization', A)
      .send({ data: [{ ...item, value: '9.000 passos' }] }).expect(200);
    const res = await request(app).get('/api/extracted-data').set('Authorization', A);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ value: '9.000 passos', source: 'apple_health' });
  });

  it('rejeita categoria desconhecida', async () => {
    await request(app).post('/api/extracted-data').set('Authorization', A)
      .send({ data: [{ category: 'astrologia', label: 'x', value: 'y', timestamp: 1 }] }).expect(400);
  });

  it('permite corrigir e excluir só os próprios registros', async () => {
    const created = await request(app).post('/api/extracted-data').set('Authorization', A)
      .send({ data: [{ category: 'mood', label: 'Humor', value: 'bom', timestamp: 1 }] });
    const id = created.body.ids[0];
    await request(app).patch(`/api/extracted-data/${id}`).set('Authorization', B).send({ value: 'hackeado' }).expect(404);
    await request(app).delete(`/api/extracted-data/${id}`).set('Authorization', B).expect(404);
    const fixed = await request(app).patch(`/api/extracted-data/${id}`).set('Authorization', A).send({ value: 'ótimo' }).expect(200);
    expect(fixed.body.data.value).toBe('ótimo');
    await request(app).delete(`/api/extracted-data/${id}`).set('Authorization', A).expect(200);
    const { rows } = await pool.query('SELECT 1 FROM extracted_data');
    expect(rows).toHaveLength(0);
  });

  it('extração vinculada à mensagem é idempotente e marca a mensagem como processada', async () => {
    const Anthropic = require('@anthropic-ai/sdk');
    const reply = { content: [{ type: 'text', text: JSON.stringify({ data: [{ category: 'sleep', label: 'Sono', value: '7h', rawText: 'dormi 7h' }, { category: 'inventada', label: 'x', value: 'y' }] }) }] };
    Anthropic.__mockCreate.mockResolvedValue(reply);
    await request(app).put('/api/messages/m1').set('Authorization', A).send({ role: 'user', content: 'dormi 7h', timestamp: 1000 });
    await request(app).post('/api/extract').set('Authorization', A).set('x-api-key', 'k')
      .send({ message: 'dormi 7h', messageId: 'm1' }).expect(200);
    const again = await request(app).post('/api/extract').set('Authorization', A).set('x-api-key', 'k')
      .send({ message: 'dormi 7h', messageId: 'm1' }).expect(200);
    expect(again.body.data).toHaveLength(1); // a categoria inventada foi descartada
    const { rows } = await pool.query('SELECT message_id, source, timestamp FROM extracted_data');
    expect(rows).toEqual([{ message_id: 'm1', source: 'chat', timestamp: '1001' }]);
    const msgs = await request(app).get('/api/messages').set('Authorization', A);
    expect(msgs.body.messages[0].extractedAt).toEqual(expect.any(Number));
    expect(msgs.body.messages[0].extractedData).toHaveLength(1);
    // Descartar o registro na revisão também o tira do resumo da mensagem.
    await request(app).delete(`/api/extracted-data/${again.body.data[0].id}`).set('Authorization', A).expect(200);
    const after = await request(app).get('/api/messages').set('Authorization', A);
    expect(after.body.messages[0].extractedData).toBeUndefined();
    // Outra conta não consegue extrair para a mensagem de A.
    await request(app).post('/api/extract').set('Authorization', B).set('x-api-key', 'k')
      .send({ message: 'x', messageId: 'm1' }).expect(404);
    Anthropic.__mockCreate.mockReset();
  });
});

describe('imagens do chat', () => {
  it('são salvas com dono e vinculadas à mensagem', async () => {
    const png = Buffer.from('fake png').toString('base64');
    const up = await request(app).post('/api/chat-images').set('Authorization', A)
      .send({ imageBase64: png, mimeType: 'image/png' }).expect(200);
    await request(app).put('/api/messages/img1').set('Authorization', A)
      .send({ role: 'user', content: '📷', timestamp: 5, imageId: up.body.id }).expect(200);
    const file = await request(app).get(`/api/chat-images/${up.body.id}/file`).set('Authorization', A).expect(200);
    expect(file.body.toString()).toBe('fake png');
    await request(app).get(`/api/chat-images/${up.body.id}/file`).set('Authorization', B).expect(404);
    // B não pode anexar a imagem de A numa mensagem própria.
    await request(app).put('/api/messages/img2').set('Authorization', B)
      .send({ role: 'user', content: '📷', timestamp: 5, imageId: up.body.id }).expect(400);
    const msgs = await request(app).get('/api/messages').set('Authorization', A);
    expect(msgs.body.messages[0].imageId).toBe(up.body.id);
  });
});

describe('sessões e conta', () => {
  const bcrypt = require('bcryptjs');

  beforeEach(async () => {
    await pool.query(`INSERT INTO users (id, name, email, password_hash) VALUES ('u_c','C','c@x.com',$1)
      ON CONFLICT (id) DO UPDATE SET password_hash=$1, token_version=0`, [await bcrypt.hash('senha123', 4)]);
  });

  it('"sair de todos os aparelhos" invalida tokens já emitidos', async () => {
    const C = tokenFor('u_c');
    await request(app).get('/api/profile').set('Authorization', C).expect(200);
    await request(app).post('/auth/logout-all').set('Authorization', C).expect(200);
    await request(app).get('/api/profile').set('Authorization', C).expect(401);
  });

  it('trocar a senha exige a atual e devolve um token novo válido', async () => {
    const C = tokenFor('u_c');
    await request(app).post('/auth/password').set('Authorization', C)
      .send({ currentPassword: 'errada', newPassword: 'nova12345' }).expect(403);
    const res = await request(app).post('/auth/password').set('Authorization', C)
      .send({ currentPassword: 'senha123', newPassword: 'nova12345' }).expect(200);
    await request(app).get('/api/profile').set('Authorization', C).expect(401);
    await request(app).get('/api/profile').set('Authorization', `Bearer ${res.body.token}`).expect(200);
  });

  it('excluir a conta apaga todos os dados do usuário', async () => {
    const C = tokenFor('u_c');
    await request(app).post('/api/meal-plan').set('Authorization', C).send({ meals: [{ id: 'mc', name: 'x', time: '10:00' }] });
    await request(app).post('/api/meal-plan/checkins').set('Authorization', C).send({ mealId: 'mc', date: '2026-09-20', status: 'done' });
    await request(app).put('/api/messages/mc1').set('Authorization', C).send({ role: 'user', content: 'x', timestamp: 1 });
    await request(app).delete('/auth/account').set('Authorization', C).send({ password: 'errada' }).expect(403);
    await request(app).delete('/auth/account').set('Authorization', C).send({ password: 'senha123' }).expect(200);
    for (const t of ['users', 'meals', 'meal_checkins', 'messages', 'extracted_data']) {
      const col = t === 'users' ? 'id' : 'user_id';
      const { rowCount } = await pool.query(`SELECT 1 FROM ${t} WHERE ${col}='u_c'`);
      expect(rowCount).toBe(0);
    }
    await request(app).get('/api/profile').set('Authorization', C).expect(401);
  });
});

describe('health', () => {
  it('confere o banco', async () => {
    await request(app).get('/health').expect(200, { ok: true });
  });
});

describe('séries realizadas', () => {
  beforeEach(async () => {
    await request(app).post('/api/workout-plans').set('Authorization', A)
      .send({ plans: [{ id: 'w1', name: 'Treino A', exercises: [{ id: 'e1', name: 'Supino' }] }] }).expect(200);
  });

  it('grava as séries, substitui ao salvar de novo e calcula a evolução', async () => {
    const put = (date, sets) => request(app).put('/api/workout-logs').set('Authorization', A)
      .send({ workoutPlanId: 'w1', exerciseId: 'e1', exerciseName: 'Supino', date, sets });
    await put('2026-09-10', [{ reps: 10, loadKg: 40 }, { reps: 8, loadKg: 45 }]).expect(200);
    await put('2026-09-17', [{ reps: 10, loadKg: 45 }]).expect(200);
    await put('2026-09-17', [{ reps: 10, loadKg: 45 }, { reps: 6, loadKg: 50 }]).expect(200);

    const day = await request(app).get('/api/workout-logs?date=2026-09-17').set('Authorization', A);
    expect(day.body.sets.map((s) => [s.setIndex, s.reps, s.loadKg])).toEqual([[0, 10, 45], [1, 6, 50]]);

    const hist = await request(app).get('/api/workout-logs/history?exercise=supino').set('Authorization', A);
    expect(hist.body.history).toEqual([
      { date: '2026-09-17', maxLoadKg: 50, repsAtMax: 6, sets: 2, totalReps: 16, volumeKg: 750 },
      { date: '2026-09-10', maxLoadKg: 45, repsAtMax: 8, sets: 2, totalReps: 18, volumeKg: 760 },
    ]);
  });

  it('não aceita séries em ficha de outra conta nem mostra o histórico dela', async () => {
    await request(app).put('/api/workout-logs').set('Authorization', B)
      .send({ workoutPlanId: 'w1', exerciseId: 'e1', exerciseName: 'Supino', date: '2026-09-10', sets: [{ reps: 1, loadKg: 1 }] })
      .expect(404);
    await request(app).put('/api/workout-logs').set('Authorization', A)
      .send({ workoutPlanId: 'w1', exerciseId: 'e1', exerciseName: 'Supino', date: '2026-09-10', sets: [{ reps: 10, loadKg: 40 }] });
    const hist = await request(app).get('/api/workout-logs/history?exercise=Supino').set('Authorization', B);
    expect(hist.body.history).toEqual([]);
  });
});

describe('ficha em PDF enviada em partes', () => {
  const pdf = Buffer.from('%PDF-1.4 ficha grande de teste '.repeat(4000));

  async function sendInChunks(token, chunkSize = 50_000) {
    const { body } = await request(app).post('/api/uploads').set('Authorization', token)
      .send({ size: pdf.length, mimeType: 'application/pdf' }).expect(200);
    for (let i = 0, index = 0; i < pdf.length; i += chunkSize, index++) {
      // Partes em binário puro, como o app envia.
      await request(app).put(`/api/uploads/${body.id}/chunks/${index}`).set('Authorization', token)
        .set('Content-Type', 'application/octet-stream').send(pdf.subarray(i, i + chunkSize)).expect(200);
    }
    return body.id;
  }

  it('recebe o arquivo em partes, lê a ficha e guarda a foto de cada exercício (sem chave de IA)', async () => {
    const id = await sendInChunks(B); // B não tem chave de IA: o leitor de layout não precisa
    const res = await request(app).post(`/api/extract-workout/upload/${id}`).set('Authorization', B).expect(200);
    expect(res.body.method).toBe('layout');
    const [plan] = res.body.plans;
    expect(plan).toMatchObject({ name: 'Treino B', dayLabel: 'H2- B', routine: 'Hipertrofia 02' });
    expect(plan.exercises[0].imageId).toEqual(expect.any(String));
    expect(plan.exercises[1].imageId).toBeUndefined();

    // Foto acessível só para o dono.
    const file = await request(app).get(`/api/exercise-images/${plan.exercises[0].imageId}/file`).set('Authorization', B).expect(200);
    expect(file.body.toString()).toBe('jpeg-1');
    await request(app).get(`/api/exercise-images/${plan.exercises[0].imageId}/file`).set('Authorization', A).expect(404);

    // Salvar a ficha guarda rotina e foto.
    await request(app).post('/api/workout-plans').set('Authorization', B).send({ plans: [{ ...plan, id: 'wb' }] }).expect(200);
    const saved = await request(app).get('/api/workout-plans').set('Authorization', B);
    expect(saved.body.plans[0]).toMatchObject({ routine: 'Hipertrofia 02' });
    expect(saved.body.plans[0].exercises[0].imageId).toBe(plan.exercises[0].imageId);

    // O envio é consumido: não dá para processar de novo.
    await request(app).post(`/api/extract-workout/upload/${id}`).set('Authorization', B).expect(404);
  });

  it('partes fora de ordem são recusadas, repetidas são aceitas, e outra conta não usa o envio', async () => {
    const { body } = await request(app).post('/api/uploads').set('Authorization', A)
      .send({ size: 10, mimeType: 'application/pdf' }).expect(200);
    const part = Buffer.from('12345').toString('base64');
    await request(app).put(`/api/uploads/${body.id}/chunks/1`).set('Authorization', A).send({ data: part }).expect(409);
    await request(app).put(`/api/uploads/${body.id}/chunks/0`).set('Authorization', A).send({ data: part }).expect(200);
    await request(app).put(`/api/uploads/${body.id}/chunks/0`).set('Authorization', A).send({ data: part }).expect(200);
    const status = await request(app).get(`/api/uploads/${body.id}`).set('Authorization', A).expect(200);
    expect(status.body).toEqual({ received: 5, nextIndex: 1, size: 10 });
    await request(app).put(`/api/uploads/${body.id}/chunks/1`).set('Authorization', B).send({ data: part }).expect(404);
    // Incompleto: 5 de 10 bytes.
    await request(app).post(`/api/extract-workout/upload/${body.id}`).set('Authorization', A).expect(400);
  });

  it('recusa arquivo acima do limite e tipo diferente de PDF', async () => {
    await request(app).post('/api/uploads').set('Authorization', A).send({ size: 300 * 1024 * 1024, mimeType: 'application/pdf' }).expect(413);
    await request(app).post('/api/uploads').set('Authorization', A).send({ size: 10, mimeType: 'video/mp4' }).expect(400);
  });
});
