import { getStore } from './platformStore'

const STORE_FILE = 'auth.json'

const TOKEN_KEY = 'erp_token'
const USER_KEY = 'erp_user'

export async function getToken(): Promise<string | null> {
  const store = await getStore(STORE_FILE);
  const value = await store.get<string>(TOKEN_KEY)
  return value ?? null
}

export async function setToken(token: string): Promise<void> {
  const store = await getStore(STORE_FILE);
  await store.set(TOKEN_KEY, token)
  // Explicit flush rather than relying on the default 100ms autoSave debounce —
  // this store exists specifically so a session survives an immediate app close,
  // so the write must be durable before that debounce window has a chance to run.
  await store.save()
}

export async function getUser(): Promise<object | null> {
  const store = await getStore(STORE_FILE);
  const value = await store.get<object>(USER_KEY)
  return value ?? null
}

export async function setUser(user: object): Promise<void> {
  const store = await getStore(STORE_FILE);
  await store.set(USER_KEY, user)
  await store.save()
}

export async function clearAuth(): Promise<void> {
  const store = await getStore(STORE_FILE);
  await store.delete(TOKEN_KEY)
  await store.delete(USER_KEY)
  await store.save()
}
