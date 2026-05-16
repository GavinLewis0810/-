import { useEffect, useState } from 'react';
import Taro from '@tarojs/taro';
import { View, Text, ScrollView } from '@tarojs/components';
import { getDashboardStats, getBudgetPrediction } from '../../services/api';
import './index.scss';

interface KPI {
  label: string;
  value: string;
  unit: string;
  color: string;
  icon: string;
}

export default function DashboardPage() {
  const [kpis, setKpis] = useState<KPI[]>([]);
  const [budgetList, setBudgetList] = useState<any[]>([]);
  const [predictionWarnings, setPredictionWarnings] = useState<any[]>([]);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const stats = await getDashboardStats();
      setKpis([
        { label: '累计发票', value: String(stats.reimbursedInvoiceCount || 0), unit: '张', color: '#1677ff', icon: '📄' },
        { label: '报销总额', value: formatAmount(stats.totalReimbursedAmount || 0), unit: '', color: '#52c41a', icon: '💰' },
        { label: '审批通过率', value: String(stats.approvalRate || 0), unit: '%', color: '#faad14', icon: '✅' },
        { label: 'AI拦截', value: String(stats.aiRejectCount || 0), unit: '单', color: '#E42313', icon: '🛡️' },
      ]);
      setBudgetList((stats.budgetData || []).slice(0, 5));
    } catch { /* */ }

    try {
      const pred = await getBudgetPrediction();
      const warnings = (pred.predictions || []).filter(
        (p: any) => p.status === 'critical' || p.status === 'warning',
      );
      setPredictionWarnings(warnings);
    } catch { /* */ }
  };

  const formatAmount = (v: number): string => {
    if (v >= 10000) return `${(v / 10000).toFixed(1)}万`;
    return String(v);
  };

  return (
    <ScrollView className='page' scrollY refresherEnabled onRefresherRefresh={async () => { await fetchData(); }}>
      <View className='top-bar'>
        <Text className='top-title'>财务智能驾驶舱</Text>
        <Text className='top-subtitle'>数据大屏 · 概览</Text>
      </View>

      {/* KPI 卡片 */}
      <View className='kpi-grid'>
        {kpis.map(k => (
          <View key={k.label} className='kpi-card' style={{ borderTop: `3px solid ${k.color}` }}>
            <Text className='kpi-icon'>{k.icon}</Text>
            <Text className='kpi-value' style={{ color: k.color }}>
              {k.value}<Text className='kpi-unit'>{k.unit}</Text>
            </Text>
            <Text className='kpi-label'>{k.label}</Text>
          </View>
        ))}
      </View>

      {/* 预算消耗排行 */}
      <View className='section'>
        <Text className='section-title'>📊 项目预算消耗 TOP5</Text>
        {budgetList.map((b: any, idx: number) => {
          const rate = Number(b.usage_rate || 0);
          return (
            <View key={idx} className='budget-row'>
              <View className='budget-info'>
                <Text className='budget-name' numberOfLines={1}>{b.project_name || b.project_code}</Text>
                <Text className='budget-amount'>¥{Number(b.used).toLocaleString()} / ¥{Number(b.budget).toLocaleString()}</Text>
              </View>
              <View className='progress-bar'>
                <View
                  className='progress-fill'
                  style={{
                    width: `${Math.min(rate, 100)}%`,
                    background: rate > 80 ? '#E42313' : rate > 60 ? '#faad14' : '#1677ff',
                  }}
                />
              </View>
              <Text className='budget-rate' style={{ color: rate > 80 ? '#E42313' : rate > 60 ? '#faad14' : '#1677ff' }}>
                {rate}%
              </Text>
            </View>
          );
        })}
      </View>

      {/* 预算耗尽预警 */}
      {predictionWarnings.length > 0 && (
        <View className='section'>
          <Text className='section-title'>⚠️ 预算耗尽预警</Text>
          {predictionWarnings.map((p: any, idx: number) => (
            <View key={idx} className='warning-card' style={{
              borderLeft: `4px solid ${p.status === 'critical' ? '#E42313' : '#faad14'}`,
            }}>
              <Text className='warn-project'>{p.project_name || p.project_code}</Text>
              <Text className='warn-text'>
                {p.status === 'critical' ? '🔴 紧急' : '🟡 预警'} · 预计 {p.days_remaining} 天后耗尽
              </Text>
              <Text className='warn-date'>{p.predicted_exhaustion_date}</Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}
