import * as SecureStore from 'expo-secure-store';

/**
 * A sessão do Supabase passa de 2 KB, limite de cada item do SecureStore: guardamos em pedaços.
 * O token fica no armazenamento seguro do aparelho (Keychain no iOS, Keystore no Android).
 */
const CHUNK = 1800;

export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    const n = Number(await SecureStore.getItemAsync(`${key}.n`));
    if (!n) return null;
    let out = '';
    for (let i = 0; i < n; i++) {
      const part = await SecureStore.getItemAsync(`${key}.${i}`);
      if (part === null) return null;
      out += part;
    }
    return out;
  },
  async setItem(key: string, value: string): Promise<void> {
    await secureStorage.removeItem(key);
    const parts = value.match(new RegExp(`.{1,${CHUNK}}`, 'gs')) ?? [''];
    for (let i = 0; i < parts.length; i++) await SecureStore.setItemAsync(`${key}.${i}`, parts[i]!);
    await SecureStore.setItemAsync(`${key}.n`, String(parts.length));
  },
  async removeItem(key: string): Promise<void> {
    const n = Number(await SecureStore.getItemAsync(`${key}.n`));
    for (let i = 0; i < n; i++) await SecureStore.deleteItemAsync(`${key}.${i}`);
    await SecureStore.deleteItemAsync(`${key}.n`);
  },
};
