import { useEffect, useState } from 'react';
import Taro from '@tarojs/taro';
import { View, Text, ScrollView } from '@tarojs/components';
import { getNotifications, markNotificationRead, markAllNotificationsRead } from '../../services/api';
import { isLoggedIn } from '../../services/auth';
import type { NotificationItem } from '../../types';
import './index.scss';

export default function NotificationsPage() {
  const [list, setList] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!isLoggedIn()) { Taro.reLaunch({ url: '/pages/index/index' }); return; }
    fetchList();
  }, []);

  const fetchList = async () => {
    try { setList(await getNotifications()); }
    catch { Taro.showToast({ title: '加载失败', icon: 'error' }); }
    finally { setLoading(false); }
  };

  const onRefresh = async () => {
    setRefreshing(true); await fetchList(); setRefreshing(false);
  };

  const handleRead = async (item: NotificationItem) => {
    if (item.is_read) return;
    try {
      await markNotificationRead(item.id);
      setList(prev => prev.map(n => n.id === item.id ? { ...n, is_read: true } : n));
    } catch { /* */ }
    // 如果有 entity_type 和 entity_id，尝试跳转
    if (item.entity_type && item.entity_id) {
      const routeMap: Record<string, string> = {
        'invoice': `/pages/invoice-detail/index?id=${item.entity_id}`,
        'reimbursement': `/pages/reimbursement-detail/index?id=${item.entity_id}`,
        'application': `/pages/applications/index`,
        'borrowing': `/pages/borrowings/index`,
      };
      const url = routeMap[item.entity_type];
      if (url) Taro.navigateTo({ url });
    }
  };

  const handleMarkAll = async () => {
    try {
      await markAllNotificationsRead();
      setList(prev => prev.map(n => ({ ...n, is_read: true })));
      Taro.showToast({ title: '全部已读', icon: 'success' });
    } catch { Taro.showToast({ title: '操作失败', icon: 'error' }); }
  };

  const unreadCount = list.filter(n => !n.is_read).length;

  return (
    <View className='nt-page'>
      <View className='nt-banner'>
        <View className='banner-top'>
          <Text className='banner-title'>消息通知</Text>
          {unreadCount > 0 && (
            <View className='mark-all' onClick={handleMarkAll}>
              <Text className='mark-all-text'>全部已读</Text>
            </View>
          )}
        </View>
        <Text className='banner-sub'>{unreadCount > 0 ? `${unreadCount} 条未读` : '暂无未读消息'}</Text>
      </View>

      <ScrollView
        scrollY className='nt-scroll'
        refresherEnabled refresherTriggered={refreshing}
        onRefresherRefresh={onRefresh}
      >
        <View className='nt-container'>
          {loading ? (
            <View className='empty-wrap'><Text className='empty-text'>加载中...</Text></View>
          ) : list.length === 0 ? (
            <View className='empty-wrap'>
              <View className='empty-icon-circle'><Text className='empty-icon'>🔔</Text></View>
              <Text className='empty-text'>暂无消息</Text>
              <Text className='empty-hint'>审批状态变更时会收到通知</Text>
            </View>
          ) : (
            list.map(n => (
              <View
                key={n.id}
                className={`nt-card ${n.is_read ? '' : 'nt-unread'}`}
                onClick={() => handleRead(n)}
              >
                <View className='nt-head'>
                  <View className='nt-title-row'>
                    {!n.is_read && <View className='unread-dot' />}
                    <Text className='nt-title' numberOfLines={1}>{n.title}</Text>
                  </View>
                  <Text className='nt-time'>{n.created_at?.slice(0, 16)}</Text>
                </View>
                {n.message && (
                  <Text className='nt-body' numberOfLines={2}>{n.message}</Text>
                )}
                {n.entity_type && (
                  <Text className='nt-link'>查看详情 ›</Text>
                )}
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}
