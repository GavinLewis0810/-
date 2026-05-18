import { useEffect, useState } from 'react';
import Taro from '@tarojs/taro';
import { View, Text, ScrollView } from '@tarojs/components';
import { getDashboardStats, getBudgetPrediction, listInvoices, getReimbursements, getUnreadCount } from '../../services/api';
import { isLoggedIn } from '../../services/auth';
import { storage } from '../../utils/storage';
import './index.scss';

interface KPI {
  label: string;
  value: string;
  unit: string;
  color: string;
  icon: string;
}

export default function DashboardPage() {
  const user = storage.getUser();
  const [kpis, setKpis] = useState<KPI[]>([]);
  const [budgetList, setBudgetList] = useState<any[]>([]);
  const [predictionWarnings, setPredictionWarnings] = useState<any[]>([]);
  const [recentInvoices, setRecentInvoices] = useState<any[]>([]);
  const [pendingReimbs, setPendingReimbs] = useState<any[]>([]);
  const [unread, setUnread] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!isLoggedIn()) {
      Taro.reLaunch({ url: '/pages/index/index' });
      return;
    }
    fetchAll();
  }, []);

  const fetchAll = async () => {
    try {
      const stats = await getDashboardStats();
      setKpis([
        { label: '累计发票', value: String(stats.reimbursedInvoiceCount || 0), unit: '张', color: '#2f54eb', icon: '📄' },
        { label: '报销总额', value: formatAmount(stats.totalReimbursedAmount || 0), unit: '', color: '#07c160', icon: '💰' },
        { label: '审批通过率', value: String(stats.approvalRate || 0), unit: '%', color: '#ff9900', icon: '✅' },
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

    try {
      const invRes = await listInvoices({ page_size: 3 });
      setRecentInvoices(invRes.items || []);
    } catch { /* */ }

    try {
      const reimbRes = await getReimbursements();
      const list = Array.isArray(reimbRes) ? reimbRes : (reimbRes as any)?.items || [];
      setPendingReimbs(list.filter((r: any) => r.status === '待审批' || r.status === '草稿').slice(0, 3));
    } catch { /* */ }

    try {
      const res = await getUnreadCount();
      setUnread(res.count);
    } catch { /* */ }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchAll();
    setRefreshing(false);
  };

  const formatAmount = (v: number): string => {
    if (v >= 10000) return `${(v / 10000).toFixed(1)}万`;
    return String(v);
  };

  return (
    <ScrollView
      className='dash-page'
      scrollY
      refresherEnabled
      refresherTriggered={refreshing}
      onRefresherRefresh={onRefresh}
    >
      {/* 顶部欢迎横幅 */}
      <View className='dash-banner'>
        <View className='banner-left'>
          <Text className='banner-greeting'>早上好 👋</Text>
          <Text className='banner-name'>{user?.full_name || user?.username || '用户'}</Text>
        </View>
        <View className='banner-right' onClick={() => Taro.navigateTo({ url: '/pages/notifications/index' })}>
          <Text className='bell-icon'>🔔</Text>
          {unread > 0 && <View className='badge'><Text className='badge-num'>{unread > 99 ? '99+' : String(unread)}</Text></View>}
        </View>
      </View>

      {/* KPI 卡片 */}
      <View className='dash-section'>
        <View className='kpi-grid'>
          {kpis.map(k => (
            <View key={k.label} className='kpi-card' style={{ borderTopColor: k.color }}>
              <Text className='kpi-icon'>{k.icon}</Text>
              <Text className='kpi-value' style={{ color: k.color }}>
                {k.value}<Text className='kpi-unit'>{k.unit}</Text>
              </Text>
              <Text className='kpi-label'>{k.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* 快捷操作 */}
      <View className='dash-section'>
        <Text className='section-title'>快捷操作</Text>
        <View className='quick-actions'>
          <View className='action-item' onClick={() => Taro.navigateTo({ url: '/pages/upload/index' })}>
            <View className='action-icon-wrap' style={{ background: 'rgba(47,84,235,0.1)' }}>
              <Text className='action-icon'>📸</Text>
            </View>
            <Text className='action-label'>上传发票</Text>
          </View>
          <View className='action-item' onClick={() => Taro.navigateTo({ url: '/pages/reimbursement-create/index' })}>
            <View className='action-icon-wrap' style={{ background: 'rgba(7,193,96,0.1)' }}>
              <Text className='action-icon'>📝</Text>
            </View>
            <Text className='action-label'>新建报销</Text>
          </View>
          <View className='action-item' onClick={() => Taro.navigateTo({ url: '/pages/application-create/index' })}>
            <View className='action-icon-wrap' style={{ background: 'rgba(255,153,0,0.1)' }}>
              <Text className='action-icon'>📋</Text>
            </View>
            <Text className='action-label'>事前申请</Text>
          </View>
          <View className='action-item' onClick={() => Taro.navigateTo({ url: '/pages/borrowing-create/index' })}>
            <View className='action-icon-wrap' style={{ background: 'rgba(47,84,235,0.12)' }}>
              <Text className='action-icon'>💳</Text>
            </View>
            <Text className='action-label'>借款申请</Text>
          </View>
        </View>
      </View>

      {/* 最近发票 */}
      <View className='dash-section'>
        <View className='section-header'>
          <Text className='section-title'>最近发票</Text>
          <Text className='section-more' onClick={() => Taro.switchTab({ url: '/pages/invoices/index' })}>全部 ›</Text>
        </View>
        {recentInvoices.length === 0 ? (
          <View className='empty-card'>
            <Text className='empty-text'>暂无发票，立即上传</Text>
          </View>
        ) : (
          recentInvoices.map(inv => (
            <View key={inv.id} className='mini-card' onClick={() => Taro.navigateTo({ url: `/pages/invoice-detail/index?id=${inv.id}` })}>
              <View className='mini-left'>
                <Text className='mini-name' numberOfLines={1}>{inv.file_name}</Text>
                <Text className='mini-meta'>{inv.invoice_number || '待识别'} · {inv.created_at?.slice(0, 10)}</Text>
              </View>
              <Text className='mini-amount'>¥{Number(inv.total_with_tax || 0).toLocaleString()}</Text>
            </View>
          ))
        )}
      </View>

      {/* 待处理报销 */}
      {pendingReimbs.length > 0 && (
        <View className='dash-section'>
          <View className='section-header'>
            <Text className='section-title'>待处理报销</Text>
            <Text className='section-more' onClick={() => Taro.switchTab({ url: '/pages/reimbursements/index' })}>全部 ›</Text>
          </View>
          {pendingReimbs.map(r => (
            <View key={r.id} className='mini-card' onClick={() => Taro.navigateTo({ url: `/pages/reimbursement-detail/index?id=${r.id}` })}>
              <View className='mini-left'>
                <Text className='mini-name' numberOfLines={1}>#{r.id} {r.title}</Text>
                <View className='mini-meta-row'>
                  <Text className={`status-dot ${r.status === '待审批' ? 'dot-warn' : 'dot-default'}`}>
                    {r.status}
                  </Text>
                </View>
              </View>
              <Text className='mini-amount'>¥{Number(r.total_amount || 0).toLocaleString()}</Text>
            </View>
          ))}
        </View>
      )}

      {/* 预算预警 */}
      {predictionWarnings.length > 0 && (
        <View className='dash-section'>
          <Text className='section-title'>⚠️ 预算预警</Text>
          {predictionWarnings.map((p: any, idx: number) => (
            <View key={idx} className='warn-card'>
              <View className='warn-top'>
                <Text className='warn-project'>{p.project_name || p.project_code}</Text>
                <Text className='warn-level' style={{
                  color: p.status === 'critical' ? '#E42313' : '#ff9900',
                  background: p.status === 'critical' ? 'rgba(228,35,19,0.08)' : 'rgba(255,153,0,0.08)',
                }}>
                  {p.status === 'critical' ? '紧急' : '预警'}
                </Text>
              </View>
              <Text className='warn-desc'>预计 {p.days_remaining} 天后耗尽</Text>
              <Text className='warn-date'>{p.predicted_exhaustion_date}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}
