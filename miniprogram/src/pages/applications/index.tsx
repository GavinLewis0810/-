import { useEffect, useState } from 'react';
import Taro from '@tarojs/taro';
import { View, Text, ScrollView } from '@tarojs/components';
import { getApplications, deleteApplication } from '../../services/api';
import { isLoggedIn } from '../../services/auth';
import { storage } from '../../utils/storage';
import type { ApplicationItem } from '../../types';
import './index.scss';

const STATUS_STYLE: Record<string, { color: string; bg: string }> = {
  '待审批': { color: '#ff9900', bg: 'rgba(255,153,0,0.1)' },
  '已通过': { color: '#07c160', bg: 'rgba(7,193,96,0.1)' },
  '已驳回': { color: '#E42313', bg: 'rgba(228,35,19,0.1)' },
};

export default function ApplicationsPage() {
  const [list, setList] = useState<ApplicationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const user = storage.getUser();
  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    if (!isLoggedIn()) { Taro.reLaunch({ url: '/pages/index/index' }); return; }
    fetchList();
  }, []);

  const fetchList = async () => {
    try {
      const data = await getApplications();
      setList(data);
    } catch { Taro.showToast({ title: '加载失败', icon: 'error' }); }
    finally { setLoading(false); }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchList();
    setRefreshing(false);
  };

  const handleDelete = (id: number) => {
    Taro.showModal({
      title: '确认删除',
      content: '确定要删除该申请吗？',
      success: async (res) => {
        if (res.confirm) {
          try { await deleteApplication(id); Taro.showToast({ title: '已删除', icon: 'success' }); fetchList(); }
          catch (e: any) { Taro.showToast({ title: e.message || '删除失败', icon: 'error' }); }
        }
      },
    });
  };

  return (
    <View className='app-page'>
      <View className='app-banner'>
        <View className='banner-top'>
          <Text className='banner-title'>事前申请</Text>
          {!isAdmin && (
            <View className='create-btn' onClick={() => Taro.navigateTo({ url: '/pages/application-create/index' })}>
              <Text className='create-text'>+ 新建</Text>
            </View>
          )}
        </View>
        <Text className='banner-sub'>{isAdmin ? '审批员工的出差/业务申请' : '出差/业务申请，通过后方可报销'}</Text>
      </View>

      <ScrollView
        scrollY className='app-scroll'
        refresherEnabled refresherTriggered={refreshing}
        onRefresherRefresh={onRefresh}
      >
        <View className='app-container'>
          {loading ? (
            <View className='empty-wrap'><Text className='empty-text'>加载中...</Text></View>
          ) : list.length === 0 ? (
            <View className='empty-wrap'>
              <View className='empty-icon-circle'><Text className='empty-icon'>📋</Text></View>
              <Text className='empty-text'>暂无申请记录</Text>
              <Text className='empty-hint'>点击右上角 + 创建事前申请</Text>
            </View>
          ) : (
            list.map(a => (
              <View key={a.id} className='app-card'>
                <View className='card-head'>
                  <Text className='card-title' numberOfLines={1}>{a.title}</Text>
                  <Text className='status-tag' style={{ color: STATUS_STYLE[a.status]?.color, background: STATUS_STYLE[a.status]?.bg }}>
                    {a.status}
                  </Text>
                </View>

                <View className='card-body'>
                  <View className='body-item'>
                    <Text className='item-label'>预估金额</Text>
                    <Text className='item-value amount'>¥{Number(a.estimated_amount || 0).toLocaleString()}</Text>
                  </View>
                  {a.status === '已通过' && (
                    <View className='body-item'>
                      <Text className='item-label'>已用/总额</Text>
                      <Text className='item-value'>¥{Number(a.used_amount || 0).toFixed(0)} / ¥{Number(a.estimated_amount || 0).toFixed(0)}</Text>
                    </View>
                  )}
                  <View className='body-item'>
                    <Text className='item-label'>关联项目</Text>
                    <Text className='item-value'>{a.project_name || a.project_code || '-'}</Text>
                  </View>
                </View>

                <View className='card-foot'>
                  <Text className='foot-meta'>{a.user_name || '-'} · {a.created_at?.slice(0, 10)}</Text>
                  {a.reject_reason && a.status === '已驳回' && (
                    <Text className='foot-reason'>驳回理由：{a.reject_reason}</Text>
                  )}
                  <View className='foot-actions'>
                    <Text className='act-delete' onClick={(e) => { e.stopPropagation(); handleDelete(a.id); }}>
                      删除
                    </Text>
                  </View>
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}
