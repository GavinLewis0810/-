import { useState } from 'react';
import Taro from '@tarojs/taro';
import { View, Text, Button } from '@tarojs/components';
import { logout } from '../../services/auth';
import { storage } from '../../utils/storage';
import './index.scss';

export default function ProfilePage() {
  const user = storage.getUser();
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = () => {
    Taro.showModal({
      title: '退出登录',
      content: '确定要退出登录吗？',
      success: async (res) => {
        if (res.confirm) {
          setLoggingOut(true);
          logout();
        }
      },
    });
  };

  if (!user) {
    return (
      <View className='page'>
        <View className='empty'>
          <Text className='empty-icon'>🔒</Text>
          <Text className='empty-text'>请先登录</Text>
          <Button className='empty-btn' onClick={() => Taro.reLaunch({ url: '/pages/index/index' })}>
            去登录
          </Button>
        </View>
      </View>
    );
  }

  return (
    <View className='page'>
      {/* 头像区域 */}
      <View className='profile-header'>
        <View className='avatar'>
          <Text className='avatar-text'>{(user.full_name || user.username || '?')[0]}</Text>
        </View>
        <Text className='profile-name'>{user.full_name || user.username}</Text>
        <Text className='profile-role'>{user.role === 'admin' ? '管理员' : '普通用户'}</Text>
      </View>

      {/* 信息卡片 */}
      <View className='info-card'>
        <View className='field-row'>
          <Text className='f-label'>用户名</Text>
          <Text className='f-value'>{user.username}</Text>
        </View>
        <View className='field-row'>
          <Text className='f-label'>姓名</Text>
          <Text className='f-value'>{user.full_name || '-'}</Text>
        </View>
        <View className='field-row'>
          <Text className='f-label'>部门</Text>
          <Text className='f-value'>{user.department || '-'}</Text>
        </View>
        <View className='field-row'>
          <Text className='f-label'>角色</Text>
          <Text className='f-value'>{user.role === 'admin' ? '管理员' : '用户'}</Text>
        </View>
      </View>

      {/* 快捷入口 */}
      <View className='info-card'>
        <Text className='section-title'>快捷功能</Text>
        <View className='menu-item' onClick={() => Taro.navigateTo({ url: '/pages/upload/index' })}>
          <Text className='menu-text'>📸 上传发票</Text>
          <Text className='menu-arrow'>›</Text>
        </View>
      </View>

      {/* 退出 */}
      <Button className='logout-btn' onClick={handleLogout} loading={loggingOut}>
        退出登录
      </Button>
    </View>
  );
}
