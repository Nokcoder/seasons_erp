// platformStore.ts
//
// Storage adapter that works both inside the Tauri desktop wrapper and in a
// plain browser tab. Inside Tauri, backs onto @tauri-apps/plugin-store (a
// real file on disk, persisted across app restarts). In a browser, falls
// back to localStorage, wrapped in the same async get/set/save/delete
// interface — every hook built on top of this (auth persistence, the print
// template library, function assignments, layout settings) works unchanged
// in either environment, with zero per-hook branching.
//
// Detection uses @tauri-apps/api/core's isTauri() — the documented,
// supported way to tell whether the current window is a real Tauri webview
// or not, rather than guessing from user-agent strings or similar.

import { isTauri } from '@tauri-apps/api/core';

export interface PlatformStore {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  save(): Promise<void>;
  delete(key: string): Promise<void>;
}

function createLocalStorageAdapter(fileName: string): PlatformStore {
  // Namespaced by fileName so different logical "stores" (auth vs. print
  // settings) don't collide in localStorage's single flat key space.
  const prefix = `${fileName}::`;

  return {
    async get(key) {
      const raw = window.localStorage.getItem(prefix + key);
      if (raw == null) return undefined;
      try {
        return JSON.parse(raw);
      } catch {
        return undefined;
      }
    },
    async set(key, value) {
      window.localStorage.setItem(prefix + key, JSON.stringify(value));
    },
    async save() {
      // localStorage writes are already synchronous and immediate — nothing
      // to flush. Exists only so callers don't need an if-Tauri branch.
    },
    async delete(key) {
      window.localStorage.removeItem(prefix + key);
    },
  };
}

async function createTauriAdapter(fileName: string): Promise<PlatformStore> {
  const { load } = await import('@tauri-apps/plugin-store');
  const store = await load(fileName, { autoSave: false });
  return {
    get: (key) => store.get(key),
    set: (key, value) => store.set(key, value),
    save: () => store.save(),
    delete: (key) => store.delete(key),
  };
}

const instances = new Map<string, Promise<PlatformStore>>();

/**
 * Get (or lazily create) the store for a given logical file name. Same
 * fileName argument you'd pass to Tauri's own `load()` — e.g.
 * 'print-settings.json', 'auth.json'. Cached per fileName so repeated calls
 * (e.g. from multiple hook instances) share the same underlying instance.
 */
export function getStore(fileName: string): Promise<PlatformStore> {
  let instance = instances.get(fileName);
  if (!instance) {
    instance = isTauri() ? createTauriAdapter(fileName) : Promise.resolve(createLocalStorageAdapter(fileName));
    instances.set(fileName, instance);
  }
  return instance;
}