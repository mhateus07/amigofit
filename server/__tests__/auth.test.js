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
const bcrypt = require('bcryptjs');
const { app } = require('../index');
const { __mockQuery: mockQuery } = require('pg');

describe('Auth do backend', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  describe('POST /auth/register', () => {
    it('cria um usuário novo e retorna token', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // SELECT id FROM users WHERE email=...
        .mockResolvedValueOnce({ rows: [] }); // INSERT INTO users

      const res = await request(app)
        .post('/auth/register')
        .send({ name: 'Mateus', email: 'mateus@example.com', password: 'senha123' });

      expect(res.status).toBe(200);
      expect(res.body.token).toEqual(expect.any(String));
      expect(res.body.user).toMatchObject({ name: 'Mateus', email: 'mateus@example.com' });
    });

    it('rejeita e-mail já cadastrado com 409', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'u_1' }] });

      const res = await request(app)
        .post('/auth/register')
        .send({ name: 'Mateus', email: 'ja@existe.com', password: 'senha123' });

      expect(res.status).toBe(409);
    });

    it('rejeita campos obrigatórios ausentes com 400', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({ name: '', email: '', password: '' });

      expect(res.status).toBe(400);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('rejeita senha curta com 400', async () => {
      const res = await request(app)
        .post('/auth/register')
        .send({ name: 'Mateus', email: 'a@b.com', password: '123' });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /auth/login', () => {
    it('autentica com credenciais corretas e retorna token', async () => {
      const passwordHash = await bcrypt.hash('senha123', 10);
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'u_1', name: 'Mateus', email: 'mateus@example.com', password_hash: passwordHash }],
      });

      const res = await request(app)
        .post('/auth/login')
        .send({ email: 'mateus@example.com', password: 'senha123' });

      expect(res.status).toBe(200);
      expect(res.body.token).toEqual(expect.any(String));
      expect(res.body.user.email).toBe('mateus@example.com');
    });

    it('rejeita senha incorreta com 401', async () => {
      const passwordHash = await bcrypt.hash('senha123', 10);
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'u_1', name: 'Mateus', email: 'mateus@example.com', password_hash: passwordHash }],
      });

      const res = await request(app)
        .post('/auth/login')
        .send({ email: 'mateus@example.com', password: 'senha_errada' });

      expect(res.status).toBe(401);
    });

    it('rejeita e-mail inexistente com 401', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .post('/auth/login')
        .send({ email: 'ninguem@example.com', password: 'senha123' });

      expect(res.status).toBe(401);
    });
  });

  describe('Rotas protegidas', () => {
    it('retorna 401 quando não há token', async () => {
      const res = await request(app).get('/auth/me');
      expect(res.status).toBe(401);
    });

    it('retorna 401 quando o token é inválido', async () => {
      const res = await request(app)
        .get('/auth/me')
        .set('Authorization', 'Bearer token-invalido');

      expect(res.status).toBe(401);
    });

    it('permite acesso com token válido', async () => {
      const jwt = require('jsonwebtoken');
      const token = jwt.sign({ userId: 'u_1', name: 'Mateus' }, process.env.JWT_SECRET, { expiresIn: '1d' });
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'u_1', name: 'Mateus', email: 'mateus@example.com' }] });

      const res = await request(app)
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.user.id).toBe('u_1');
    });
  });
});
