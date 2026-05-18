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
      {/* 顶部品牌背景区 */}
      <View className='brand-header'>
        <View className='logo-circle'>
          <Text className='logo-icon'>💰</Text>
        </View>
        <Text className='brand-title'>智能发票报销系统</Text>
        <Text className='brand-subtitle'>AI-Powered Invoice Manager</Text>
      </View>

      {/* 悬浮登录表单卡片 */}
      <View className='form-container'>
        <View className='ui-card login-card'>
          <Text className='card-title'>欢迎登录</Text>
          
          <View className='input-group'>
            <View className='input-item'>
              <Text className='input-label'>账号</Text>
              <Input
                className='login-input'
                placeholder='请输入用户名'
                placeholderClass='input-placeholder'
                value={username}
                onInput={e => setUsername(e.detail.value)}
              />
            </View>
            
            <View className='input-item'>
              <Text className='input-label'>密码</Text>
              <Input
                className='login-input'
                placeholder='请输入密码'
                placeholderClass='input-placeholder'
                password
                value={password}
                onInput={e => setPassword(e.detail.value)}
              />
            </View>
          </View>

          <Button
            className='login-btn'
            onClick={handleLogin}
            loading={loading}
            disabled={loading}
          >
            {loading ? '登录中...' : '登 录'}
          </Button>

          <View className='hint-wrapper'>
            <Text className='login-hint'>使用 Web 端账号进行登录</Text>
          </View>
        </View>
      </View>
      
      {/* 底部版权信息 */}
      <View className='footer-info'>
        <Text>提供安全的企业级财务报销服务</Text>
      </View>
    </View>
  );
}