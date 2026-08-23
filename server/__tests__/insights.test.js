/**
 * @jest-environment node
 */
process.env.JWT_SECRET = 'test_secret_only_for_jest';

jest.mock('pg', () => {
  const mQuery = jest.fn();
  return {
    Pool: jest.fn().mockImplementation(() => ({ query: mQuery, connect: jest.fn() })),
    __mockQuery: mQuery,
  };
});

jest.mock('@anthropic-ai/sdk', () => {
  const mCreate = jest.fn();
  const MockAnthropic = jest.fn().mockImplementation(() => ({ messages: { create: mCreate } }));
  MockAnthropic.__mockCreate = mCreate;
  return MockAnthropic;
});

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { app } = require('../index');
const Anthropic = require('@anthropic-ai/sdk');
const mockCreate = Anthropic.__mockCreate;

function authToken() {
  return jwt.sign({ userId: 'u_1', name: 'Mateus' }, process.env.JWT_SECRET, { expiresIn: '1d' });
}

const sampleData = [
  { category: 'sleep', label: 'Sono', value: '5h', rawText: 'dormi 5h', timestamp: Date.now() },
  { category: 'sleep', label: 'Sono', value: '5.5h', rawText: 'dormi 5h30', timestamp: Date.now() },
  { category: 'workout', label: 'Treino', value: 'Pernas', rawText: 'treinei pernas', timestamp: Date.now() },
];

describe('POST /api/insights', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('retorna 401 sem token', async () => {
    const res = await request(app)
      .post('/api/insights')
      .send({ data: sampleData });

    expect(res.status).toBe(401);
  });

  it('retorna 401 sem x-api-key', async () => {
    const res = await request(app)
      .post('/api/insights')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ data: sampleData });

    expect(res.status).toBe(401);
  });

  it('rejeita quando data não é array', async () => {
    const res = await request(app)
      .post('/api/insights')
      .set('Authorization', `Bearer ${authToken()}`)
      .set('x-api-key', 'fake-key')
      .send({ data: 'nope' });

    expect(res.status).toBe(400);
  });

  it('retorna os insights gerados pelo provedor (anthropic por padrão)', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{
        type: 'text',
        text: JSON.stringify({
          insights: [
            { icon: '🌙', title: 'Sono baixo', description: 'Você dormiu pouco essa semana.', severity: 'warning' },
          ],
        }),
      }],
    });

    const res = await request(app)
      .post('/api/insights')
      .set('Authorization', `Bearer ${authToken()}`)
      .set('x-api-key', 'fake-key')
      .send({ data: sampleData, profile: { goal: 'hypertrophy', level: 'beginner' } });

    expect(res.status).toBe(200);
    expect(res.body.insights).toHaveLength(1);
    expect(res.body.insights[0]).toMatchObject({ title: 'Sono baixo', severity: 'warning' });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('retorna array vazio quando não há dados nos últimos 30 dias', async () => {
    const oldData = [{ category: 'sleep', label: 'Sono', value: '5h', rawText: '', timestamp: Date.now() - 60 * 86400000 }];

    const res = await request(app)
      .post('/api/insights')
      .set('Authorization', `Bearer ${authToken()}`)
      .set('x-api-key', 'fake-key')
      .send({ data: oldData });

    expect(res.status).toBe(200);
    expect(res.body.insights).toEqual([]);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('retorna 500 quando o provedor falha', async () => {
    mockCreate.mockRejectedValueOnce(new Error('provider down'));

    const res = await request(app)
      .post('/api/insights')
      .set('Authorization', `Bearer ${authToken()}`)
      .set('x-api-key', 'fake-key')
      .send({ data: sampleData });

    expect(res.status).toBe(500);
    expect(res.body.error).toEqual(expect.any(String));
  });
});
