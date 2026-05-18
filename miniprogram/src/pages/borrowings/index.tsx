import { useEffect, useState } from 'react';
import Taro from '@tarojs/taro';
import { View, Text, ScrollView } from '@tarojs/components';
import { getBorrowings, deleteBorrowing } from '../../services/api';
import { isLoggedIn } from '../../services/auth';
import type { BorrowingItem } from '../../types';
import './index.scss';

const STATUS_STYLE: Record<string, { color: string; bg: string }> = {
  '待审批': { color: '#ff9900', bg: 'rgba(255,153,0,0.1)' },
  '已批准': { color: '#07c160', bg: 'rgba(7,193,96,0.1)' },
  '已驳回': { color: '#E42313', bg: 'rgba(228,35,19,0.1)' },
  '已冲销': { color: '#2f54eb', bg: 'rgba(47,84,235,0.1)' },
};

export default function BorrowingsPage() {
  const [list, setList] = useState<BorrowingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!isLoggedIn()) { Taro.reLaunch({ url: '/pages/index/index' }); return; }
    fetchList();
  }, []);

  const fetchList = async () => {
    try { setList(await getBorrowings()); }
    catch { Taro.showToast({ title: '加载失败', icon: 'error' }); }
    finally { setLoading(false); }
  };

  const onRefresh = async () => {
    setRefreshing(true); await fetchList(); setRefreshing(false);
  };

  const handleDelete = (id: number) => {
    Taro.showModal({
      title: '确认删除', content: '确定要删除该借款记录吗？',
      success: async (res) => {
        if (res.confirm) {
          try { await deleteBorrowing(id); Taro.showToast({ title: '已删除', icon: 'success' }); fetchList(); }
          catch (e: any) { Taro.showToast({ title: e.message || '删除失败', icon: 'error' }); }
        }
      },
    });
  };

  return (
    <View className='br-page'>
      <View className='br-banner'>
        <View className='banner-top'>
          <Text className='banner-title'>借款记录</Text>
        </View>
        <Text className='banner-sub'>拨款由财务管理员在事前申请通过后操作</Text>
      </View>

      <ScrollView
        scrollY className='br-scroll'
        refresherEnabled refresherTriggered={refreshing}
        onRefresherRefresh={onRefresh}
      >
        <View className='br-container'>
          {loading ? (
            <View className='empty-wrap'><Text className='empty-text'>加载中...</Text></View>
          ) : list.length === 0 ? (
            <View className='empty-wrap'>
              <View className='empty-icon-circle'><Text className='empty-icon'>💳</Text></View>
              <Text className='empty-text'>暂无借款记录</Text>
              <Text className='empty-hint'>通过事前申请审批后可创建借款</Text>
            </View>
          ) : (
            list.map(b => (
              <View key={b.id} className='br-card'>
                <View className='card-head'>
                  <Text className='card-title' numberOfLines={1}>{b.title}</Text>
                  <Text className='status-tag' style={{ color: STATUS_STYLE[b.status]?.color, background: STATUS_STYLE[b.status]?.bg }}>
                    {b.status}
                  </Text>
                </View>

                <View className='card-body'>
                  <View className='body-item'>
                    <Text className='item-label'>借款金额</Text>
                    <Text className='item-value amount'>¥{Number(b.estimated_amount || 0).toLocaleString()}</Text>
                  </View>
                  <View className='body-item'>
                    <Text className='item-label'>预计还款日</Text>
                    <Text className='item-value'>{b.expected_repayment_date || '-'}</Text>
                  </View>
                  {b.repaid_amount != null && (
                    <View className='body-item'>
                      <Text className='item-label'>已冲销</Text>
                      <Text className='item-value' style={{ color: '#07c160' }}>¥{Number(b.repaid_amount).toFixed(2)}</Text>
                    </View>
                  )}
                  {b.application_title && (
                    <View className='body-item'>
                      <Text className='item-label'>关联申请</Text>
                      <Text className='item-value'>{b.application_title}</Text>
                    </View>
                  )}
                </View>

                <View className='card-foot'>
                  <Text className='foot-meta'>{b.user_name || '-'} · {b.created_at?.slice(0, 10)}</Text>
                  {b.reject_reason && b.status === '已驳回' && (
                    <Text className='foot-reason'>驳回：{b.reject_reason}</Text>
                  )}
                  <View className='foot-actions'>
                    <Text className='act-delete' onClick={(e) => { e.stopPropagation(); handleDelete(b.id); }}>删除</Text>
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
