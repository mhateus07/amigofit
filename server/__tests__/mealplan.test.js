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

describe('Plano alimentar', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockClientQuery.mockReset();
    mockRelease.mockReset();
  });

  describe('GET /api/meal-plan', () => {
    it('retorna 401 sem token', async () => {
      const res = await request(app).get('/api/meal-plan');
      expect(res.status).toBe(401);
    });

    it('retorna as refeições ativas do usuário', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'meal_1', name: 'Almoço', time: '12:00', description: null, items: ['arroz', 'frango'], source: 'manual' }],
      });

      const res = await request(app)
        .get('/api/meal-plan')
        .set('Authorization', `Bearer ${authToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.meals).toHaveLength(1);
      expect(res.body.meals[0].name).toBe('Almoço');
    });
  });

  describe('POST /api/meal-plan', () => {
    it('rejeita quando meals não é array', async () => {
      const res = await request(app)
        .post('/api/meal-plan')
        .set('Authorization', `Bearer ${authToken()}`)
        .send({ meals: 'nope' });

      expect(res.status).toBe(400);
    });

    it('substitui o plano em uma transação (delete + reinsert)', async () => {
      mockClientQuery.mockResolvedValue({ rows: [] });

      const res = await request(app)
        .post('/api/meal-plan')
        .set('Authorization', `Bearer ${authToken()}`)
        .send({ meals: [{ name: 'Café da manhã', time: '07:00', items: ['ovos'] }] });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(mockClientQuery).toHaveBeenCalledWith('BEGIN');
      expect(mockClientQuery).toHaveBeenCalledWith('DELETE FROM meals WHERE user_id=$1', ['u_1']);
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
        .post('/api/meal-plan')
        .set('Authorization', `Bearer ${authToken()}`)
        .send({ meals: [{ name: 'Jantar', time: '19:00', items: [] }] });

      expect(res.status).toBe(500);
      expect(mockClientQuery).toHaveBeenCalledWith('ROLLBACK');
      expect(mockRelease).toHaveBeenCalled();
    });
  });

  describe('GET /api/meal-plan/checkins', () => {
    it('exige o parâmetro date', async () => {
      const res = await request(app)
        .get('/api/meal-plan/checkins')
        .set('Authorization', `Bearer ${authToken()}`);

      expect(res.status).toBe(400);
    });

    it('retorna os checkins do dia', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ mealId: 'meal_1', date: '2026-07-07', status: 'done', checkedAt: 1720000000000 }],
      });

      const res = await request(app)
        .get('/api/meal-plan/checkins?date=2026-07-07')
        .set('Authorization', `Bearer ${authToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.checkins[0].status).toBe('done');
    });
  });

  describe('POST /api/meal-plan/checkins', () => {
    it('exige mealId, date e status', async () => {
      const res = await request(app)
        .post('/api/meal-plan/checkins')
        .set('Authorization', `Bearer ${authToken()}`)
        .send({});

      expect(res.status).toBe(400);
    });

    it('registra o check-in via upsert idempotente', async () => {
      mockClientQuery.mockResolvedValue({ rows: [] });

      const res = await request(app)
        .post('/api/meal-plan/checkins')
        .set('Authorization', `Bearer ${authToken()}`)
        .send({ mealId: 'meal_1', date: '2026-07-07', status: 'done' });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(mockClientQuery).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT'),
        ['u_1', 'meal_1', '2026-07-07', 'done', expect.any(Number)]
      );
      expect(mockClientQuery).toHaveBeenCalledWith('COMMIT');
      expect(mockRelease).toHaveBeenCalled();
    });

    it('ao marcar "done", também grava um dado de nutrição extraído', async () => {
      mockClientQuery.mockImplementation((sql) => {
        if (typeof sql === 'string' && sql.startsWith('SELECT name')) {
          return Promise.resolve({ rows: [{ name: 'Almoço', time: '12:00', description: null, items: ['arroz', 'frango'] }] });
        }
        return Promise.resolve({ rows: [] });
      });

      const res = await request(app)
        .post('/api/meal-plan/checkins')
        .set('Authorization', `Bearer ${authToken()}`)
        .send({ mealId: 'meal_1', date: '2026-07-07', status: 'done' });

      expect(res.status).toBe(200);
      expect(mockClientQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM extracted_data'),
        ['u_1', 'meal_checkin:meal_1:2026-07-07']
      );
      expect(mockClientQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO extracted_data'),
        ['u_1', 'Almoço', 'arroz, frango', 'Marcado como feita no plano alimentar (12:00)', expect.any(Number), 'meal_checkin:meal_1:2026-07-07']
      );
    });

    it('ao marcar "skipped", só remove o dado de nutrição anterior (sem inserir de novo)', async () => {
      mockClientQuery.mockResolvedValue({ rows: [] });

      const res = await request(app)
        .post('/api/meal-plan/checkins')
        .set('Authorization', `Bearer ${authToken()}`)
        .send({ mealId: 'meal_1', date: '2026-07-07', status: 'skipped' });

      expect(res.status).toBe(200);
      expect(mockClientQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM extracted_data'),
        ['u_1', 'meal_checkin:meal_1:2026-07-07']
      );
      expect(mockClientQuery).not.toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO extracted_data'),
        expect.anything()
      );
    });

    it('faz rollback e retorna 500 em caso de erro', async () => {
      mockClientQuery.mockImplementation((sql) => {
        if (typeof sql === 'string' && sql.startsWith('INSERT INTO meal_checkins')) {
          return Promise.reject(new Error('boom'));
        }
        return Promise.resolve({ rows: [] });
      });

      const res = await request(app)
        .post('/api/meal-plan/checkins')
        .set('Authorization', `Bearer ${authToken()}`)
        .send({ mealId: 'meal_1', date: '2026-07-07', status: 'done' });

      expect(res.status).toBe(500);
      expect(mockClientQuery).toHaveBeenCalledWith('ROLLBACK');
      expect(mockRelease).toHaveBeenCalled();
    });
  });
});
