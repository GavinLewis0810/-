import { useEffect, useState } from 'react';
import Taro from '@tarojs/taro';
import { View, Text, ScrollView } from '@tarojs/components';
import { getReimbursements } from '../../services/api';
import { isLoggedIn } from '../../services/auth';
import type { Reimbursement } from '../../types';
import './index.scss';

const STATUS_COLOR: Record<string, string> = {
  '草稿': 'rgba(255,255,255,0.3)',
  '待审批': '#faad14',
  '已通过': '#52c41a',
  '已驳回': '#E42313',
  '已打款': '#13c2c2',
};

export default function ReimbursementListPage() {
  const [list, setList] = useState<Reimbursement[]>([]);

  useEffect(() => {
    if (!isLoggedIn()) {
      Taro.reLaunch({ url: '/pages/index/index' });
      return;
    }
    fetchList();
  }, []);

  const fetchList = async () => {
    try {
      const res = await getReimbursements();
      // 后端可能返回数组或对象
      setList(Array.isArray(res) ? res : (res as any)?.items || []);
    } catch {
      Taro.showToast({ title: '加载失败', icon: 'error' });
    }
  };

  return (
    <View className='page'>
      <View className='top-bar'>
        <Text className='top-title'>报销单</Text>
        <Text className='create-btn' onClick={() => Taro.navigateTo({ url: '/pages/reimbursement-create/index' })}>
          + 新建
        </Text>
      </View>

      <ScrollView scrollY className='list' refresherEnabled onRefresherRefresh={async () => { await fetchList(); }}>
        {list.length === 0 ? (
          <View className='empty'>
            <Text className='empty-icon'>📋</Text>
            <Text className='empty-text'>暂无报销单</Text>
          </View>
        ) : (
          list.map(r => (
            <View
              key={r.id}
              className='reimb-card'
              onClick={() => Taro.navigateTo({ url: `/pages/reimbursement-detail/index?id=${r.id}` })}
            >
              <View className='reimb-header'>
                <Text className='reimb-title' numberOfLines={1}>#{r.id} {r.title}</Text>
                <Text className='reimb-status' style={{ color: STATUS_COLOR[r.status] || '#fff' }}>
                  {r.status}
                </Text>
              </View>
              <View className='reimb-body'>
                <Text className='reimb-amount'>¥{Number(r.total_amount || 0).toLocaleString()}</Text>
                {r.ai_risk_level && (
                  <Text className={`risk-tag ${r.ai_risk_level === '高' ? 'risk-high' : 'risk-medium'}`}>
                    {r.ai_risk_level === '高' ? '高风险' : r.ai_risk_level === '中' ? '中风险' : '低风险'}
                  </Text>
                )}
              </View>
              <View className='reimb-footer'>
                <Text className='reimb-meta'>{r.submitter || '-'} · {r.created_at?.slice(0, 10)}</Text>
                {r.project_code && <Text className='reimb-project'>{r.project_code}</Text>}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}
