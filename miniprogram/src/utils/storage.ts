import Taro from '@tarojs/taro';

const STORAGE_KEYS = {
  TOKEN: 'sessionToken',
  USER: 'currentUser',
} as const;

export const storage = {
  getToken(): string | null {
    return Taro.getStorageSync(STORAGE_KEYS.TOKEN) || null;
  },

  setToken(token: string): void {
    Taro.setStorageSync(STORAGE_KEYS.TOKEN, token);
  },

  removeToken(): void {
    Taro.removeStorageSync(STORAGE_KEYS.TOKEN);
  },

  getUser(): any | null {
    const raw = Taro.getStorageSync(STORAGE_KEYS.USER);
    return raw ? JSON.parse(raw) : null;
  },

  setUser(user: any): void {
    Taro.setStorageSync(STORAGE_KEYS.USER, JSON.stringify(user));
  },

  removeUser(): void {
    Taro.removeStorageSync(STORAGE_KEYS.USER);
  },

  clear(): void {
    Taro.clearStorageSync();
  },
};
