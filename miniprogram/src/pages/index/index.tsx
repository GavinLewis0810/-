import { useState, useEffect } from 'react';
import Taro from '@tarojs/taro';
import { View, Text, Input, Button } from '@tarojs/components';
import { passwordLogin, isLoggedIn } from '../../services/auth';
import './index.scss';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isLoggedIn()) {
      Taro.switchTab({ url: '/pages/invoices/index' });
    }
  }, []);

  const handleLogin = async () => {
    if (!username.trim()) {
      Taro.showToast({ title: '请输入用户名', icon: 'none' });
      return;
    }
    if (!password) {
      Taro.showToast({ title: '请输入密码', icon: 'none' });
      return;
    }
    setLoading(true);
    try {
      const ok = await passwordLogin(username.trim(), password);
      if (ok) {
        Taro.showToast({ title: '登录成功', icon: 'success' });
        setTimeout(() => Taro.switchTab({ url: '/pages/invoices/index' }), 600);
      } else {
        Taro.showToast({ title: '登录失败，请重试', icon: 'error' });
      }
    } catch {
      Taro.showToast({ title: '登录失败，请重试', icon: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <View className='login-page'>
      <View className='login-card'>
        <Text className='login-logo'>💰</Text>
        <Text className='login-title'>智能发票报销系统</Text>
        <Text className='login-subtitle'>AI-Powered Invoice Manager</Text>

        <View className='login-form'>
          <Input
            className='login-input'
            placeholder='用户名'
            placeholderClass='login-placeholder'
            value={username}
            onInput={e => setUsername(e.detail.value)}
          />
          <Input
            className='login-input'
            placeholder='密码'
            placeholderClass='login-placeholder'
            password
            value={password}
            onInput={e => setPassword(e.detail.value)}
          />
          <Button
            className='login-btn'
            onClick={handleLogin}
            loading={loading}
            disabled={loading}
          >
            登 录
          </Button>
          <Text className='login-hint'>使用 Web 端账号登录</Text>
        </View>
      </View>
    </View>
  );
}
