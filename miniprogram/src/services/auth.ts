// ============================================================
// 小程序登录模块
// 使用用户名+密码登录，对接后端已有 /auth/login 接口
// ============================================================

import Taro from '@tarojs/taro';
import { storage } from '../utils/storage';
import { loginWithPassword } from './api';

export async function passwordLogin(username: string, password: string): Promise<boolean> {
  try {
    const result = await loginWithPassword(username, password);
    storage.setToken(result.token);
    storage.setUser(result.user);
    return true;
  } catch (err: any) {
    console.error('[Auth] 登录失败:', err);
    return false;
  }
}

export function isLoggedIn(): boolean {
  return !!storage.getToken();
}

export function logout(): void {
  storage.clear();
  Taro.reLaunch({ url: '/pages/index/index' });
}
