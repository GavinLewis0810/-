import { useEffect, useState } from 'react';
import Taro from '@tarojs/taro';
import { View, Text, ScrollView, Picker } from '@tarojs/components';
import { listInvoices, getNotifications, getUnreadCount } from '../../services/api';
import { isLoggedIn } from '../../services/auth';
import type { Invoice } from '../../types';
import './index.scss';

export default function InvoiceListPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [unread, setUnread] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!isLoggedIn()) {
      Taro.reLaunch({ url: '/pages/index/index' });
      return;
    }
    fetchInvoices(1);
    fetchUnread();
  }, [statusFilter]);

  const fetchInvoices = async (p: number) => {
    try {
      const res = await listInvoices({ page: p, page_size: 20, status: statusFilter || undefined });
      if (p === 1) {
        setInvoices(res.items);
      } else {
        setInvoices(prev => [...prev, ...res.items]);
      }
      setTotal(res.total);
      setPage(p);
    } catch {
      Taro.showToast({ title: '加载失败', icon: 'error' });
    }
  };

  const fetchUnread = async () => {
    try {
      const res = await getUnreadCount();
      setUnread(res.count);
    } catch { /* */ }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchInvoices(1);
    setRefreshing(false);
  };

  const statusOptions = ['全部', '已上传', '待处理', '已确认', '已报销'];
  const statusClassMap: Record<string, string> = {
    '已上传': 'upl', '解析中': 'proc', '待处理': 'pend',
    '已确认': 'conf', '已报销': 'reim', '待确认': 'pend',
  };

  return (
    <View className='page'>
      {/* 顶部栏 */}
      <View className='top-bar'>
        <Text className='top-title'>发票管理</Text>
        <View className='top-actions'>
          <Picker mode='selector' range={statusOptions} onChange={e => {
            const val = statusOptions[Number(e.detail.value)];
            setStatusFilter(val === '全部' ? '' : val);
          }}>
            <Text className='filter-btn'>{statusFilter || '筛选'} ▾</Text>
          </Picker>
        </View>
      </View>

      {/* 浮动上传按钮 */}
      <View className='fab' onClick={() => Taro.navigateTo({ url: '/pages/upload/index' })}>
        <Text className='fab-icon'>+</Text>
      </View>

      {/* 列表 */}
      <ScrollView
        scrollY
        className='list'
        refresherEnabled
        refresherTriggered={refreshing}
        onRefresherRefresh={onRefresh}
        onScrollToLower={() => {
          if (invoices.length < total) fetchInvoices(page + 1);
        }}
      >
        {invoices.length === 0 ? (
          <View className='empty'>
            <Text className='empty-icon'>📭</Text>
            <Text className='empty-text'>暂无发票</Text>
            <Text className='empty-hint'>点击右下角 + 上传第一张发票</Text>
          </View>
        ) : (
          invoices.map(inv => (
            <View
              key={inv.id}
              className='invoice-card'
              onClick={() => Taro.navigateTo({ url: `/pages/invoice-detail/index?id=${inv.id}` })}
            >
              <View className='inv-header'>
                <Text className='inv-name' numberOfLines={1}>{inv.file_name}</Text>
                <Text className={`inv-status inv-status-${statusClassMap[inv.status] || 'pend'}`}>{inv.status}</Text>
              </View>
              <View className='inv-body'>
                <Text className='inv-number'>{inv.invoice_number || '发票号待识别'}</Text>
                <Text className='inv-amount'>¥{Number(inv.total_with_tax || 0).toLocaleString()}</Text>
              </View>
              <View className='inv-footer'>
                <Text className='inv-date'>{inv.issue_date || inv.created_at?.slice(0, 10)}</Text>
                {inv.carbon_kg != null && (
                  <Text className='inv-carbon'>🌱 {Number(inv.carbon_kg).toFixed(2)} kg</Text>
                )}
              </View>
            </View>
          ))
        )}
        {invoices.length > 0 && invoices.length < total && (
          <View className='load-more'>上拉加载更多 ({invoices.length}/{total})</View>
        )}
      </ScrollView>
    </View>
  );
}
