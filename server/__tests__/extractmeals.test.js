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

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { app } = require('../index');
const { __mockGetText: mockGetText } = require('pdf-parse');

function authToken() {
  return jwt.sign({ userId: 'u_1', name: 'Mateus' }, process.env.JWT_SECRET, { expiresIn: '1d' });
}

describe('POST /api/extract-meals', () => {
  beforeEach(() => {
    mockGetText.mockReset();
  });

  it('retorna 401 sem token', async () => {
    const res = await request(app)
      .post('/api/extract-meals')
      .send({ pdfBase64: 'aGVsbG8=' });

    expect(res.status).toBe(401);
  });

  it('retorna 401 sem x-api-key', async () => {
    const res = await request(app)
      .post('/api/extract-meals')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ pdfBase64: 'aGVsbG8=' });

    expect(res.status).toBe(401);
  });

  it('rejeita quando pdfBase64 esta ausente', async () => {
    const res = await request(app)
      .post('/api/extract-meals')
      .set('Authorization', `Bearer ${authToken()}`)
      .set('x-api-key', 'fake-key')
      .send({});

    expect(res.status).toBe(400);
  });

  it('retorna meals vazio com erro quando o PDF nao tem texto suficiente', async () => {
    mockGetText.mockResolvedValueOnce({ text: 'oi' });

    const res = await request(app)
      .post('/api/extract-meals')
      .set('Authorization', `Bearer ${authToken()}`)
      .set('x-api-key', 'fake-key')
      .send({ pdfBase64: 'aGVsbG8=' });

    expect(res.status).toBe(200);
    expect(res.body.meals).toEqual([]);
    expect(res.body.error).toEqual(expect.any(String));
  });

  it('retorna meals vazio com erro quando o pdf-parse falha (arquivo invalido)', async () => {
    mockGetText.mockRejectedValueOnce(new Error('invalid pdf structure'));

    const res = await request(app)
      .post('/api/extract-meals')
      .set('Authorization', `Bearer ${authToken()}`)
      .set('x-api-key', 'fake-key')
      .send({ pdfBase64: 'not-a-real-pdf' });

    expect(res.status).toBe(200);
    expect(res.body.meals).toEqual([]);
    expect(res.body.error).toEqual(expect.any(String));
  });
});
