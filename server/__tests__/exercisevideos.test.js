/**
 * @jest-environment node
 */
process.env.JWT_SECRET = 'test_secret_only_for_jest';

const os = require('os');
const path = require('path');
const fs = require('fs');

// UPLOAD_DIR é lido uma vez no require de ../index — aponta pra uma pasta
// temporária só desta suíte, pra não sujar o repo nem depender de disco real.
const TEST_UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'amigofit-videos-test-'));
process.env.UPLOAD_DIR = TEST_UPLOAD_DIR;

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
const { __mockQuery: mockQuery } = require('pg');

function authToken() {
  return jwt.sign({ userId: 'u_1', name: 'Mateus' }, process.env.JWT_SECRET, { expiresIn: '1d' });
}

afterAll(() => {
  fs.rmSync(TEST_UPLOAD_DIR, { recursive: true, force: true });
});

describe('Exercise videos', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  describe('POST /api/exercise-videos', () => {
    it('retorna 401 sem token', async () => {
      const res = await request(app)
        .post('/api/exercise-videos')
        .attach('video', Buffer.from('fake video bytes'), { filename: 'ex.mp4', contentType: 'video/mp4' });

      expect(res.status).toBe(401);
    });

    it('rejeita quando não vem arquivo', async () => {
      const res = await request(app)
        .post('/api/exercise-videos')
        .set('Authorization', `Bearer ${authToken()}`)
        .send();

      expect(res.status).toBe(400);
    });

    it('rejeita arquivo que não é vídeo', async () => {
      const res = await request(app)
        .post('/api/exercise-videos')
        .set('Authorization', `Bearer ${authToken()}`)
        .attach('video', Buffer.from('not a video'), { filename: 'ex.txt', contentType: 'text/plain' });

      expect(res.status).toBe(400);
    });

    it('salva o vídeo no disco e registra no banco', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .post('/api/exercise-videos')
        .set('Authorization', `Bearer ${authToken()}`)
        .attach('video', Buffer.from('fake video bytes'), { filename: 'ex.mp4', contentType: 'video/mp4' });

      expect(res.status).toBe(200);
      expect(res.body.id).toEqual(expect.any(String));
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO exercise_videos'),
        [res.body.id, 'u_1', expect.any(String), 'video/mp4', expect.any(Number)]
      );

      const savedFiles = fs.readdirSync(TEST_UPLOAD_DIR);
      expect(savedFiles.length).toBeGreaterThan(0);
    });
  });

  describe('GET /api/exercise-videos/:id/file', () => {
    it('retorna 401 sem token', async () => {
      const res = await request(app).get('/api/exercise-videos/abc/file');
      expect(res.status).toBe(401);
    });

    it('retorna 404 quando o vídeo não existe ou não é do usuário', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .get('/api/exercise-videos/missing/file')
        .set('Authorization', `Bearer ${authToken()}`);

      expect(res.status).toBe(404);
    });

    it('serve o arquivo quando o vídeo existe e pertence ao usuário', async () => {
      const filename = 'existing-video.mp4';
      fs.writeFileSync(path.join(TEST_UPLOAD_DIR, filename), 'conteudo de video fake');
      mockQuery.mockResolvedValueOnce({ rows: [{ filename, mime_type: 'video/mp4' }] });

      const res = await request(app)
        .get('/api/exercise-videos/vid_1/file')
        .set('Authorization', `Bearer ${authToken()}`);

      expect(res.status).toBe(200);
    });
  });

  describe('DELETE /api/exercise-videos/:id', () => {
    it('retorna 401 sem token', async () => {
      const res = await request(app).delete('/api/exercise-videos/abc');
      expect(res.status).toBe(401);
    });

    it('retorna 404 quando o vídeo não existe ou não é do usuário', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .delete('/api/exercise-videos/missing')
        .set('Authorization', `Bearer ${authToken()}`);

      expect(res.status).toBe(404);
    });

    it('remove o arquivo do disco e a linha do banco', async () => {
      const filename = 'to-delete.mp4';
      fs.writeFileSync(path.join(TEST_UPLOAD_DIR, filename), 'conteudo');
      mockQuery
        .mockResolvedValueOnce({ rows: [{ filename }] })
        .mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .delete('/api/exercise-videos/vid_1')
        .set('Authorization', `Bearer ${authToken()}`);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM exercise_videos'),
        ['vid_1', 'u_1']
      );
    });
  });
});
