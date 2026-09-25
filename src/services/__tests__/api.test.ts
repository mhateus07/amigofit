import * as SecureStore from 'expo-secure-store';
import { apiRequest, ApiError, StaleSessionError, newSessionEpoch, onUnauthorized } from '../api';

jest.mock('expo-secure-store', () => {
  const store: Record<string, string> = {};
  return {
    getItemAsync: jest.fn(async (k: string) => store[k] ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => { store[k] = v; }),
    deleteItemAsync: jest.fn(async (k: string) => { delete store[k]; }),
  };
});

function response(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h: string) => headers[h] ?? null },
    json: async () => body,
  };
}

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  onUnauthorized(null);
});

describe('apiRequest', () => {
  it('lança ApiError com a mensagem do servidor em respostas de erro (antes era ignorado)', async () => {
    global.fetch = jest.fn().mockResolvedValue(response(409, { error: 'Conflito' })) as unknown as typeof fetch;
    await expect(apiRequest('/api/x')).rejects.toMatchObject({ name: 'ApiError', status: 409, message: 'Conflito' });
  });

  it('transforma falha de rede em ApiError status 0 com mensagem clara', async () => {
    global.fetch = jest.fn().mockRejectedValue(new TypeError('Network request failed')) as unknown as typeof fetch;
    const err = (await apiRequest('/api/x').catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.message).toMatch(/Sem conexão/);
  });

  it('encerra a sessão quando o token é recusado, mas não quando falta chave de IA', async () => {
    const handler = jest.fn();
    onUnauthorized(handler);
    global.fetch = jest.fn().mockResolvedValue(response(401, { error: 'API key ausente. Configure a chave' })) as unknown as typeof fetch;
    await expect(apiRequest('/api/chat')).rejects.toThrow('API key ausente');
    expect(handler).not.toHaveBeenCalled();

    global.fetch = jest.fn().mockResolvedValue(response(401, { error: 'Sessão encerrada. Entre novamente.' })) as unknown as typeof fetch;
    await expect(apiRequest('/api/profile')).rejects.toThrow('Sessão encerrada');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('descarta respostas que chegam depois de trocar de conta', async () => {
    let resolve: (v: unknown) => void = () => {};
    global.fetch = jest.fn().mockReturnValue(new Promise((r) => { resolve = r; })) as unknown as typeof fetch;
    const pending = apiRequest('/api/profile');
    newSessionEpoch(); // logout/login no meio do caminho
    resolve(response(200, { profile: { name: 'conta anterior' } }));
    await expect(pending).rejects.toBeInstanceOf(StaleSessionError);
  });

  it('guarda o token renovado pelo servidor', async () => {
    global.fetch = jest.fn().mockResolvedValue(response(200, { ok: true }, { 'x-auth-token': 'novo-token' })) as unknown as typeof fetch;
    await apiRequest('/api/profile');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('amigofit_token', 'novo-token');
  });
});
