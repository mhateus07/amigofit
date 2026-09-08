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

jest.mock('pdf-parse', () => {
  const mockGetText = jest.fn();
  const mockDestroy = jest.fn();
  return {
    PDFParse: jest.fn().mockImplementation(() => ({ getText: mockGetText, destroy: mockDestroy })),
    __mockGetText: mockGetText,
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
const { __mockGetText: mockGetText } = require('pdf-parse');
const Anthropic = require('@anthropic-ai/sdk');
const mockCreate = Anthropic.__mockCreate;

function authToken() {
  return jwt.sign({ userId: 'u_1', name: 'Mateus' }, process.env.JWT_SECRET, { expiresIn: '1d' });
}

describe('POST /api/extract-workout', () => {
  beforeEach(() => {
    mockGetText.mockReset();
    mockCreate.mockReset();
  });

  it('retorna 401 sem token', async () => {
    const res = await request(app)
      .post('/api/extract-workout')
      .send({ pdfBase64: 'aGVsbG8=' });

    expect(res.status).toBe(401);
  });

  it('retorna 401 sem x-api-key', async () => {
    const res = await request(app)
      .post('/api/extract-workout')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ pdfBase64: 'aGVsbG8=' });

    expect(res.status).toBe(401);
  });

  it('rejeita quando pdfBase64 esta ausente', async () => {
    const res = await request(app)
      .post('/api/extract-workout')
      .set('Authorization', `Bearer ${authToken()}`)
      .set('x-api-key', 'fake-key')
      .send({});

    expect(res.status).toBe(400);
  });

  it('retorna plans vazio com erro quando o PDF nao tem texto suficiente', async () => {
    mockGetText.mockResolvedValueOnce({ text: 'oi' });

    const res = await request(app)
      .post('/api/extract-workout')
      .set('Authorization', `Bearer ${authToken()}`)
      .set('x-api-key', 'fake-key')
      .send({ pdfBase64: 'aGVsbG8=' });

    expect(res.status).toBe(200);
    expect(res.body.plans).toEqual([]);
    expect(res.body.error).toEqual(expect.any(String));
  });

  it('retorna plans vazio com erro quando o pdf-parse falha (arquivo invalido)', async () => {
    mockGetText.mockRejectedValueOnce(new Error('invalid pdf structure'));

    const res = await request(app)
      .post('/api/extract-workout')
      .set('Authorization', `Bearer ${authToken()}`)
      .set('x-api-key', 'fake-key')
      .send({ pdfBase64: 'not-a-real-pdf' });

    expect(res.status).toBe(200);
    expect(res.body.plans).toEqual([]);
    expect(res.body.error).toEqual(expect.any(String));
  });

  it('retorna as fichas extraídas pelo provedor (anthropic por padrão)', async () => {
    mockGetText.mockResolvedValueOnce({ text: 'Treino A - Peito\n1. Supino reto 4x8-12\n2. Crucifixo 3x12' });
    mockCreate.mockResolvedValueOnce({
      content: [{
        type: 'text',
        text: JSON.stringify({
          plans: [{
            name: 'Treino A - Peito',
            dayLabel: 'Segunda',
            exercises: [
              { name: 'Supino reto', sets: 4, reps: '8-12' },
              { name: 'Crucifixo', sets: 3, reps: '12' },
            ],
          }],
        }),
      }],
    });

    const res = await request(app)
      .post('/api/extract-workout')
      .set('Authorization', `Bearer ${authToken()}`)
      .set('x-api-key', 'fake-key')
      .send({ pdfBase64: 'aGVsbG8=' });

    expect(res.status).toBe(200);
    expect(res.body.plans).toHaveLength(1);
    expect(res.body.plans[0].name).toBe('Treino A - Peito');
    expect(res.body.plans[0].exercises).toHaveLength(2);
    expect(res.body.plans[0].exercises[0]).toMatchObject({ name: 'Supino reto', sets: 4, reps: '8-12' });
  });

  it('rejeita quando nem pdfBase64 nem imageBase64 vêm no body', async () => {
    const res = await request(app)
      .post('/api/extract-workout')
      .set('Authorization', `Bearer ${authToken()}`)
      .set('x-api-key', 'fake-key')
      .send({});

    expect(res.status).toBe(400);
  });

  it('extrai a ficha a partir de uma foto (anthropic, bloco de imagem)', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{
        type: 'text',
        text: JSON.stringify({
          plans: [{ name: 'Treino B - Costas', dayLabel: null, exercises: [{ name: 'Puxada frontal', sets: 4, reps: '10' }] }],
        }),
      }],
    });

    const res = await request(app)
      .post('/api/extract-workout')
      .set('Authorization', `Bearer ${authToken()}`)
      .set('x-api-key', 'fake-key')
      .send({ imageBase64: 'aGVsbG8=', mimeType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(res.body.plans).toHaveLength(1);
    expect(res.body.plans[0].name).toBe('Treino B - Costas');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.messages[0].content[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'aGVsbG8=' } });
  });

  it('retorna erro claro quando o provedor é Groq (sem visão)', async () => {
    const res = await request(app)
      .post('/api/extract-workout')
      .set('Authorization', `Bearer ${authToken()}`)
      .set('x-api-key', 'fake-key')
      .set('x-provider', 'groq')
      .send({ imageBase64: 'aGVsbG8=', mimeType: 'image/jpeg' });

    expect(res.status).toBe(200);
    expect(res.body.plans).toEqual([]);
    expect(res.body.error).toMatch(/não suporta análise de imagem/);
  });
});
