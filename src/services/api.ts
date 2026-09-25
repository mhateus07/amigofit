import * as SecureStore from 'expo-secure-store';

export const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://amigofit-api.impulsiodigital.com';

export const TOKEN_KEY = 'amigofit_token';

// Erro de uma chamada ao backend. status 0 = sem resposta (rede/timeout).
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// Resposta que chegou depois de trocar de conta: é descartada em silêncio.
export class StaleSessionError extends Error {
  constructor() {
    super('Sessão anterior');
    this.name = 'StaleSessionError';
  }
}

export function isStaleSession(e: unknown): boolean {
  return e instanceof StaleSessionError;
}

// Mensagem para mostrar ao usuário a partir de qualquer erro.
export function errorMessage(e: unknown, fallback = 'Algo deu errado. Tente novamente.'): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

// ── Sessão ────────────────────────────────────────────────
// Cada login/logout incrementa a "época" da sessão. Uma requisição iniciada
// numa época anterior não pode entregar dados à conta atual.
let sessionEpoch = 0;
let unauthorizedHandler: (() => void) | null = null;

export function newSessionEpoch(): void {
  sessionEpoch += 1;
}

export function onUnauthorized(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

async function readToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

// ── Requisição ────────────────────────────────────────────
interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  timeoutMs?: number;
  // Requisições de login/cadastro não mandam token nem disparam logout em 401.
  anonymous?: boolean;
}

export const DEFAULT_TIMEOUT_MS = 20_000;
// Chamadas de IA (chat, extração de PDF, transcrição) demoram mais.
export const AI_TIMEOUT_MS = 100_000;

export async function apiRequest<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, timeoutMs = DEFAULT_TIMEOUT_MS, anonymous = false } = options;
  const epoch = sessionEpoch;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (!anonymous) {
    const token = await readToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    if (epoch !== sessionEpoch) throw new StaleSessionError();
    const aborted = e instanceof Error && e.name === 'AbortError';
    throw new ApiError(0, aborted
      ? 'O servidor demorou demais para responder. Tente novamente.'
      : 'Sem conexão com o servidor. Verifique sua internet e tente novamente.');
  } finally {
    clearTimeout(timer);
  }

  if (epoch !== sessionEpoch) throw new StaleSessionError();

  // Token renovado pelo servidor (sessões longas sem precisar logar de novo).
  const renewed = res.headers.get('x-auth-token');
  if (renewed && !anonymous) await SecureStore.setItemAsync(TOKEN_KEY, renewed);

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && !anonymous && data?.error && /token|sessão/i.test(data.error)) {
      unauthorizedHandler?.();
    }
    throw new ApiError(res.status, data?.error || `Erro ${res.status} no servidor.`);
  }
  return data as T;
}
