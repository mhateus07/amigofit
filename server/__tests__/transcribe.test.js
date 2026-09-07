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

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { app } = require('../index');

function authToken() {
  return jwt.sign({ userId: 'u_1', name: 'Mateus' }, process.env.JWT_SECRET, { expiresIn: '1d' });
}

const AUDIO_B64 = Buffer.from('fake audio bytes').toString('base64');

describe('POST /api/transcribe', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('retorna 401 sem token', async () => {
    const res = await request(app)
      .post('/api/transcribe')
      .send({ audioBase64: AUDIO_B64, mimeType: 'audio/m4a' });

    expect(res.status).toBe(401);
  });

  it('retorna 401 sem x-api-key', async () => {
    const res = await request(app)
      .post('/api/transcribe')
      .set('Authorization', `Bearer ${authToken()}`)
      .send({ audioBase64: AUDIO_B64, mimeType: 'audio/m4a' });

    expect(res.status).toBe(401);
  });

  it('rejeita quando audioBase64 está ausente', async () => {
    const res = await request(app)
      .post('/api/transcribe')
      .set('Authorization', `Bearer ${authToken()}`)
      .set('x-api-key', 'fake-key')
      .set('x-provider', 'groq')
      .send({ mimeType: 'audio/m4a' });

    expect(res.status).toBe(400);
  });

  it('retorna 500 com mensagem clara quando o provedor é anthropic', async () => {
    const res = await request(app)
      .post('/api/transcribe')
      .set('Authorization', `Bearer ${authToken()}`)
      .set('x-api-key', 'fake-key')
      .set('x-provider', 'anthropic')
      .send({ audioBase64: AUDIO_B64, mimeType: 'audio/m4a' });

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/não suporta transcrição/);
  });

  it('transcreve via Groq (endpoint Whisper compatível com OpenAI)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'dormi bem essa noite' }),
    });

    const res = await request(app)
      .post('/api/transcribe')
      .set('Authorization', `Bearer ${authToken()}`)
      .set('x-api-key', 'fake-key')
      .set('x-provider', 'groq')
      .send({ audioBase64: AUDIO_B64, mimeType: 'audio/m4a' });

    expect(res.status).toBe(200);
    expect(res.body.text).toBe('dormi bem essa noite');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.groq.com/openai/v1/audio/transcriptions',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('transcreve via Gemini (áudio inline no generateContent)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'treinei pernas hoje' }] } }] }),
    });

    const res = await request(app)
      .post('/api/transcribe')
      .set('Authorization', `Bearer ${authToken()}`)
      .set('x-api-key', 'fake-key')
      .set('x-provider', 'gemini')
      .send({ audioBase64: AUDIO_B64, mimeType: 'audio/m4a' });

    expect(res.status).toBe(200);
    expect(res.body.text).toBe('treinei pernas hoje');
  });

  it('retorna 500 quando o provedor falha', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'Invalid API key' } }),
    });

    const res = await request(app)
      .post('/api/transcribe')
      .set('Authorization', `Bearer ${authToken()}`)
      .set('x-api-key', 'bad-key')
      .set('x-provider', 'groq')
      .send({ audioBase64: AUDIO_B64, mimeType: 'audio/m4a' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Invalid API key');
  });
});
