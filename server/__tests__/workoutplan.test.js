/**
 * @jest-environment node
 */
process.env.JWT_SECRET = 'test_secret_only_for_jest';

jest.mock('pg', () => {
  const mQuery = jest.fn();
  const mClientQuery = jest.fn();
  const mRelease = jest.fn();
  return {
    Pool: jest.fn().mockImplementation(() => ({
      query: mQuery,
      connect: jest.fn().mockResolvedValue({ query: mClientQuery, release: mRelease }),
    })),
    __mockQuery: mQuery,
    __mockClientQuery: mClientQuery,
    __mockRelease: mRelease,
  };
});

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { app } = require('../index');
const {
  __mockQuery: mockQuery,
  __mockClientQuery: mockClientQuery,
  __mockRelease: mockRelease,
} = require('pg');

function authToken() {
  return jwt.sign({ userId: 'u_1', name: 'Mateus' }, process.env.JWT_SECRET, { expiresIn: '1d' });
}

describe('Fichas de treino', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockClientQuery.mockReset();
    mockRelease.mockReset();
  });

  describe('GET /api/workout-plans', () => {
    it('retorna 401 sem token', async () => {
      const res = await request(app).get('/api/workout-plans');
      expect(res.status).toBe(401);
    });

    it('retorna as fichas ativas do usuário', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'wp_1', name: 'Treino A', dayLabel: 'Segunda', exercises: [{ id: 'e1', name: 'Supino' }], source: 'manual' }],
      });

      const res = await request(app)
        .get('/api/workout-plans')
        .set('Authorization', `Bearer ${authToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.plans).toHaveLength(1);
      expect(res.body.plans[0].name).toBe('Treino A');
    });
  });

  describe('POST /api/workout-plans', () => {
    it('rejeita quando plans não é array', async () => {
      const res = await request(app)
        .post('/api/workout-plans')
        .set('Authorization', `Bearer ${authToken()}`)
        .send({ plans: 'nope' });

      expect(res.status).toBe(400);
    });

    it('substitui as fichas em uma transação (delete + reinsert)', async () => {
      mockClientQuery.mockResolvedValue({ rows: [] });

      const res = await request(app)
        .post('/api/workout-plans')
        .set('Authorization', `Bearer ${authToken()}`)
        .send({ plans: [{ name: 'Treino A', exercises: [{ id: 'e1', name: 'Supino' }] }] });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(mockClientQuery).toHaveBeenCalledWith('BEGIN');
      expect(mockClientQuery).toHaveBeenCalledWith('DELETE FROM workout_plans WHERE user_id=$1', ['u_1']);
      expect(mockClientQuery).toHaveBeenCalledWith('COMMIT');
      expect(mockRelease).toHaveBeenCalled();
    });

    it('faz rollback e retorna 500 em caso de erro', async () => {
      mockClientQuery.mockImplementation((sql) => {
        if (typeof sql === 'string' && sql.startsWith('INSERT')) {
          return Promise.reject(new Error('boom'));
        }
        return Promise.resolve({ rows: [] });
      });

      const res = await request(app)
        .post('/api/workout-plans')
        .set('Authorization', `Bearer ${authToken()}`)
        .send({ plans: [{ name: 'Treino B', exercises: [] }] });

      expect(res.status).toBe(500);
      expect(mockClientQuery).toHaveBeenCalledWith('ROLLBACK');
      expect(mockRelease).toHaveBeenCalled();
    });
  });

  describe('GET /api/workout-plans/checkins', () => {
    it('exige o parâmetro date', async () => {
      const res = await request(app)
        .get('/api/workout-plans/checkins')
        .set('Authorization', `Bearer ${authToken()}`);

      expect(res.status).toBe(400);
    });

    it('retorna os checkins do dia', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ workoutPlanId: 'wp_1', date: '2026-09-08', status: 'done', checkedAt: 1720000000000 }],
      });

      const res = await request(app)
        .get('/api/workout-plans/checkins?date=2026-09-08')
        .set('Authorization', `Bearer ${authToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.checkins[0].status).toBe('done');
    });
  });

  describe('POST /api/workout-plans/checkins', () => {
    it('exige workoutPlanId, date e status', async () => {
      const res = await request(app)
        .post('/api/workout-plans/checkins')
        .set('Authorization', `Bearer ${authToken()}`)
        .send({});

      expect(res.status).toBe(400);
    });

    it('registra o check-in via upsert idempotente', async () => {
      mockClientQuery.mockResolvedValue({ rows: [] });

      const res = await request(app)
        .post('/api/workout-plans/checkins')
        .set('Authorization', `Bearer ${authToken()}`)
        .send({ workoutPlanId: 'wp_1', date: '2026-09-08', status: 'done' });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(mockClientQuery).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT'),
        ['u_1', 'wp_1', '2026-09-08', 'done', expect.any(Number)]
      );
      expect(mockClientQuery).toHaveBeenCalledWith('COMMIT');
      expect(mockRelease).toHaveBeenCalled();
    });

    it('ao marcar "done", também grava um dado de treino extraído (category workout)', async () => {
      mockClientQuery.mockImplementation((sql) => {
        if (typeof sql === 'string' && sql.startsWith('SELECT name')) {
          return Promise.resolve({ rows: [{ name: 'Treino A', exercises: [{ name: 'Supino' }, { name: 'Crucifixo' }] }] });
        }
        return Promise.resolve({ rows: [] });
      });

      const res = await request(app)
        .post('/api/workout-plans/checkins')
        .set('Authorization', `Bearer ${authToken()}`)
        .send({ workoutPlanId: 'wp_1', date: '2026-09-08', status: 'done' });

      expect(res.status).toBe(200);
      expect(mockClientQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM extracted_data'),
        ['u_1', 'workout_checkin:wp_1:2026-09-08']
      );
      expect(mockClientQuery).toHaveBeenCalledWith(
        expect.stringContaining("'workout'"),
        ['u_1', 'Treino A', 'Supino, Crucifixo', 'Marcado como concluído na ficha de treino', expect.any(Number), 'workout_checkin:wp_1:2026-09-08']
      );
    });

    it('ao marcar "skipped", só remove o dado anterior (sem inserir de novo)', async () => {
      mockClientQuery.mockResolvedValue({ rows: [] });

      const res = await request(app)
        .post('/api/workout-plans/checkins')
        .set('Authorization', `Bearer ${authToken()}`)
        .send({ workoutPlanId: 'wp_1', date: '2026-09-08', status: 'skipped' });

      expect(res.status).toBe(200);
      expect(mockClientQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM extracted_data'),
        ['u_1', 'workout_checkin:wp_1:2026-09-08']
      );
      expect(mockClientQuery).not.toHaveBeenCalledWith(
        expect.stringContaining("'workout'"),
        expect.anything()
      );
    });

    it('faz rollback e retorna 500 em caso de erro', async () => {
      mockClientQuery.mockImplementation((sql) => {
        if (typeof sql === 'string' && sql.startsWith('INSERT INTO workout_checkins')) {
          return Promise.reject(new Error('boom'));
        }
        return Promise.resolve({ rows: [] });
      });

      const res = await request(app)
        .post('/api/workout-plans/checkins')
        .set('Authorization', `Bearer ${authToken()}`)
        .send({ workoutPlanId: 'wp_1', date: '2026-09-08', status: 'done' });

      expect(res.status).toBe(500);
      expect(mockClientQuery).toHaveBeenCalledWith('ROLLBACK');
      expect(mockRelease).toHaveBeenCalled();
    });
  });
});
