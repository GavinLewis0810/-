import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { Row, Col, Card, Statistic, Empty, Tag, List } from 'antd';
import {
  FileDoneOutlined, AccountBookOutlined, CheckCircleOutlined,
  SafetyCertificateOutlined, RobotOutlined, ClockCircleOutlined,
} from '@ant-design/icons';
import { Area, Pie } from '@ant-design/plots';
import { getDashboardStats, getBudgetPrediction } from '../services/api';
import { useNavigate } from 'react-router-dom';

/* ── 蓝主题色板 ── */
const colors = {
  blue: '#4F46E5',       cyan: '#22D3EE',        emerald: '#10B981',
  amber: '#F59E0B',      violet: '#8B5CF6',      rose: '#F43F5E',
  slate800: '#1E293B',   slate900: '#0F172A',    slate950: '#020617',
  cardBg: 'rgba(255,255,255,0.05)',
};

/* ── 模块级静态样式 ── */
const s = {
  page: { padding: 24 } as const,
  cockpit: {
    position: 'relative' as const, overflow: 'hidden' as const,
    background: `linear-gradient(170deg, ${colors.slate800} 0%, #1E3A5F 40%, ${colors.slate900} 100%)`,
    borderRadius: 16, padding: 28,
    boxShadow: '0 8px 40px rgba(0,0,0,0.25)',
    transform: 'translateZ(0)', // GPU 层提升，滚动时不重绘
  },
  glowTop: {
    position: 'absolute' as const, top: '-15%', left: '-10%', width: '40%', height: '40%',
    background: 'radial-gradient(ellipse at center, rgba(34,211,238,0.06) 0%, transparent 70%)',
    borderRadius: '50%', pointerEvents: 'none' as const,
  },
  glowBottom: {
    position: 'absolute' as const, bottom: '-20%', right: '-10%', width: '50%', height: '50%',
    background: 'radial-gradient(ellipse at center, rgba(79,70,229,0.08) 0%, transparent 70%)',
    borderRadius: '50%', pointerEvents: 'none' as const,
  },
  inner: { position: 'relative' as const, zIndex: 1 },
  titleBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 },
  titleLeft: { display: 'flex', alignItems: 'center', gap: 14 },
  iconBox: {
    display: 'flex', width: 48, height: 48, alignItems: 'center', justifyContent: 'center',
    borderRadius: 12, background: 'linear-gradient(135deg, #22D3EE, #4F46E5)',
    boxShadow: '0 4px 14px rgba(34,211,238,0.3)',
  },
  h1: { color: '#fff', margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em' },
  subtitle: { color: 'rgba(255,255,255,0.4)', margin: '4px 0 0', fontSize: 13 },
  kpiRow: { marginBottom: 16 } as const,
  card: { border: 'none', borderRadius: 12, boxShadow: '0 4px 20px rgba(0,0,0,0.25)' } as const,
  statTitle: { color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: 500 } as const,
  statValue: { color: '#fff', fontSize: 36, fontWeight: 700 } as const,
  currencyPrefix: { color: 'rgba(255,255,255,0.7)', marginRight: 6, fontSize: 22 } as const,
  iconPrefix: { color: 'rgba(255,255,255,0.6)', marginRight: 8 } as const,
  cardBase: {
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 12,
    transform: 'translateZ(0)',
  } as const,
  cardHead: { borderBottom: '1px solid rgba(255,255,255,0.08)', color: '#fff' } as const,
  chartWrap: { height: 340, contain: 'layout style paint' } as const,
  chartWrapSmall: { height: 300, contain: 'layout style paint' } as const,
  budgetList: { height: 340, overflow: 'auto' as const, paddingRight: 6 },
  emptyDesc: { color: '#999' } as const,
  budgetItem: { marginBottom: 16, padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.03)' },
  budgetItemTop: { display: 'flex', justifyContent: 'space-between', marginBottom: 8 },
  budgetItemName: { color: '#fff', fontSize: 13, fontWeight: 600 },
  budgetTrack: { height: 8, borderRadius: 999, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' as const, marginBottom: 8 },
  budgetItemBottom: { display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'rgba(255,255,255,0.4)' },
  sectionRow: { marginTop: 16 } as const,
  pendingList: { maxHeight: 300, overflow: 'auto' as const },
  listItem: { padding: '12px 20px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.06)' },
  listItemTitle: { color: '#fff', fontWeight: 500 },
  listItemDesc: { color: 'rgba(255,255,255,0.4)', fontSize: 12 },
  tagRealTime: { fontSize: 13, padding: '4px 14px', borderRadius: 20 },
  warningPanelBody: { padding: '0 12px 12px', maxHeight: 320, overflow: 'auto' as const },
  warningCard: { borderRadius: 10, padding: '12px 14px', marginTop: 10 },
  warningTitle: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  warningProjectName: { color: '#fff', fontWeight: 600, fontSize: 14 },
  warningDetail: { fontSize: 12, color: 'rgba(255,255,255,0.6)', lineHeight: 1.8 as const },
};

/* ── 状态色映射 ── */
const statusColorsMap: Record<string, { bg: string; tag: string; icon: string }> = {
  critical: { bg: 'rgba(244,63,94,0.18)', tag: '#F43F5E', icon: '🔴' },
  warning: { bg: 'rgba(245,158,11,0.18)', tag: '#F59E0B', icon: '🟡' },
  normal: { bg: 'rgba(79,70,229,0.12)', tag: colors.blue, icon: '🔵' },
  exhausted: { bg: 'rgba(244,63,94,0.28)', tag: '#F43F5E', icon: '💀' },
  insufficient_data: { bg: 'rgba(255,255,255,0.03)', tag: 'rgba(255,255,255,0.25)', icon: '⬜' },
};

const tagColorMap: Record<string, string> = {
  normal: 'processing', critical: 'error', exhausted: 'error', warning: 'warning', insufficient_data: 'default',
};

const statusLabelMap: Record<string, string> = {
  critical: '紧急', warning: '预警', exhausted: '已耗尽', insufficient_data: '数据不足',
};

const budgetColor = (pct: number) => (pct >= 90 ? '#F43F5E' : pct >= 70 ? '#F59E0B' : colors.blue);

/* ── KPI 定义 ── */
const kpiDefs = [
  { label: '累计处理发票', suffix: '张', Icon: FileDoneOutlined, grad: 'linear-gradient(135deg, #4F46E5, #6366F1)', isCurrency: false as const },
  { label: '报销总金额', suffix: '¥', Icon: AccountBookOutlined, grad: 'linear-gradient(135deg, #10B981, #059669)', isCurrency: true as const },
  { label: '审批通过率', suffix: '%', Icon: CheckCircleOutlined, grad: 'linear-gradient(135deg, #F59E0B, #D97706)', isCurrency: false as const },
  { label: 'AI 拦截高风险单', suffix: '单', Icon: SafetyCertificateOutlined, grad: 'linear-gradient(135deg, #8B5CF6, #7C3AED)', isCurrency: false as const },
];

export default function DashboardPage() {
  const navigate = useNavigate();
  const [invoiceCount, setInvoiceCount] = useState(0);
  const [totalAmount, setTotalAmount] = useState(0);
  const [approvalRate, setApprovalRate] = useState(0);
  const [aiRejectCount, setAiRejectCount] = useState(0);
  const [trendData, setTrendData] = useState<any[]>([]);
  const [pieData, setPieData] = useState<any[]>([]);
  const [budgetData, setBudgetData] = useState<any[]>([]);
  const [pendingList, setPendingList] = useState<any[]>([]);
  const [predictionData, setPredictionData] = useState<any[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dataSnapRef = useRef<{ trend: string; pie: string; budget: string; pending: string; prediction: string; kpi: string }>({
    trend: '', pie: '', budget: '', pending: '', prediction: '', kpi: '',
  });

  const fetchAll = useCallback(async () => {
    try {
      const chartRes = await getDashboardStats();
      const newKpi = JSON.stringify({
        ic: chartRes.reimbursedInvoiceCount || 0,
        ta: chartRes.totalReimbursedAmount || 0,
        ar: chartRes.approvalRate || 0,
        arc: chartRes.aiRejectCount || 0,
      });
      if (dataSnapRef.current.kpi !== newKpi) {
        dataSnapRef.current.kpi = newKpi;
        setInvoiceCount(chartRes.reimbursedInvoiceCount || 0);
        setTotalAmount(chartRes.totalReimbursedAmount || 0);
        setApprovalRate(chartRes.approvalRate || 0);
        setAiRejectCount(chartRes.aiRejectCount || 0);
      }
      const rawTrend = chartRes.trendData || [];
      const trendMap: Record<string, number> = {};
      rawTrend.forEach((d: any) => {
        trendMap[d.month] = (trendMap[d.month] || 0) + Number(d.value || 0);
      });
      const now = new Date();
      const fullMonths: string[] = [];
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        fullMonths.push(key);
      }
      const aggregatedTrend = fullMonths.map((key) => {
        const [y, m] = key.split('-');
        return { month: `${parseInt(m)}月`, fullMonth: `${y}年${parseInt(m)}月`, value: trendMap[key] || 0 };
      });
      const newTrend = JSON.stringify(aggregatedTrend);
      if (dataSnapRef.current.trend !== newTrend) {
        dataSnapRef.current.trend = newTrend;
        setTrendData(aggregatedTrend);
      }
      const newPie = JSON.stringify(chartRes.pieData || []);
      if (dataSnapRef.current.pie !== newPie) {
        dataSnapRef.current.pie = newPie;
        setPieData(chartRes.pieData || []);
      }
      const newBudget = JSON.stringify(chartRes.budgetData || []);
      if (dataSnapRef.current.budget !== newBudget) {
        dataSnapRef.current.budget = newBudget;
        setBudgetData(chartRes.budgetData || []);
      }
      const newPending = JSON.stringify(chartRes.pendingList || []);
      if (dataSnapRef.current.pending !== newPending) {
        dataSnapRef.current.pending = newPending;
        setPendingList(chartRes.pendingList || []);
      }
      try {
        const predRes = await getBudgetPrediction();
        const newPrediction = JSON.stringify(predRes.predictions || []);
        if (dataSnapRef.current.prediction !== newPrediction) {
          dataSnapRef.current.prediction = newPrediction;
          setPredictionData(predRes.predictions || []);
        }
      } catch { /* non-blocking */ }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchAll();
    timerRef.current = setInterval(fetchAll, 30000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [fetchAll]);

  /* ── 图表配置区域 ── */

  const trendAreaConfig = useMemo(() => ({
    data: trendData,
    xField: 'month',
    yField: 'value',
    smooth: true,
    theme: 'dark' as const,
    areaStyle: { fillOpacity: 0.18 },
    line: { size: 3 },
    point: { size: 4, shape: 'circle' as const, style: { stroke: '#fff', lineWidth: 1 } },
    color: colors.blue,
    axis: {
      x: { label: { style: { fill: 'rgba(255,255,255,0.45)' } }, grid: null },
      y: {
        nice: true,
        label: {
          style: { fill: 'rgba(255,255,255,0.45)' },
          formatter: (v: number) => (v >= 10000 ? `${(v / 10000).toFixed(1)}万` : `${v}`),
        },
        grid: { line: { style: { stroke: 'rgba(255,255,255,0.05)', lineDash: [4, 4] } } },
      },
    },
    tooltip: {
      title: false,
      items: [
        (d: any) => ({
          name: d.fullMonth, // 左侧：显示年月
          value: `¥${Number(d.value).toLocaleString()}`, // 右侧：显示金额，会自动靠右对齐
        }),
      ],
    },
  }), [trendData]);

  const trendChartKey = useMemo(() => `trend-${trendData.length}-${trendData[0]?.fullMonth || ''}`, [trendData]);

  const pieConfig = useMemo(() => ({
    data: pieData,
    angleField: 'value', 
    colorField: 'type',
    radius: 0.8, innerRadius: 0.65, theme: 'dark' as const,
    color: [colors.violet, colors.amber, colors.emerald, colors.blue],
    label: { text: 'value', style: { fontWeight: 'bold' as const, fontSize: 14 } },
    legend: { layout: 'horizontal' as const, position: 'bottom' as const },
  }), [pieData]);

  const pieChartKey = useMemo(() => `pie-${pieData.length}`, [pieData]);

  const predictionFlatData = useMemo(() =>
    predictionData.flatMap((p: any) =>
      (p.cumulative_data || []).map((d: any) => ({
        date: d.date,
        amount: d.amount,
        project: (p.project_name || p.project_code || '未知').length > 10
          ? (p.project_name || p.project_code || '未知').slice(0, 10) + '...'
          : (p.project_name || p.project_code || '未知'),
        type: d.type,
      }))
    ), [predictionData]);

  const predictionChartKey = useMemo(() => `pred-${predictionFlatData.length}-${predictionData.length}`, [predictionFlatData, predictionData]);

  // 辅助线：独立数据包 + 切断父级字段继承，避免 G2 编码冲突
  const predictionAnnotations = useMemo(() =>
    predictionData
      .filter((p: any) => p.budget > 0)
      .map((p: any) => ({
        type: 'lineY' as const,
        data: [{ targetBudget: p.budget }],
        yField: 'targetBudget',
        xField: null as unknown as undefined,
        colorField: null as unknown as undefined,
        style: { stroke: 'rgba(34,211,238,0.5)', lineDash: [4, 4] as [number, number], lineWidth: 1.5 },
        tooltip: false,
      })), [predictionData]);

  const predictionAreaConfig = useMemo(() => ({
    data: predictionFlatData,
    xField: 'date',
    yField: 'amount',
    colorField: 'project', 
    smooth: false,
    theme: 'dark' as const,
    areaStyle: { fillOpacity: 0.12 },
    line: { size: 2 },
    color: [colors.blue, colors.cyan, colors.emerald, colors.violet, colors.amber, colors.rose],
    legend: { layout: 'horizontal' as const, position: 'top' as const },
    point: { size: 3, shape: 'circle' as const },
    tooltip: {
      title: (d: any) => `${d.date}`,
      formatter: (d: any) => ({
        name: `${d.project} (${d.type === 'predicted' ? '预测' : '实际'})`,
        value: `¥${Number(d.amount).toLocaleString()}`,
      }),
    },
    axis: {
      x: {
        label: { autoRotate: true, autoHide: true, style: { fill: 'rgba(255,255,255,0.55)', fontSize: 11 } },
        grid: { line: { style: { stroke: 'rgba(255,255,255,0.04)' } } },
      },
      y: {
        label: {
          style: { fill: 'rgba(255,255,255,0.4)', fontSize: 12 },
          formatter: (v: number) => (v >= 10000 ? `${(v / 10000).toFixed(1)}万` : `${v}`),
        },
        grid: { line: { style: { stroke: 'rgba(255,255,255,0.05)' } } },
      },
    },
    annotations: predictionAnnotations,
  }), [predictionFlatData, predictionAnnotations]);

  /* ── 列表数据 ── */
  const budgetItems = useMemo(() =>
    budgetData.map((item: any, idx: number) => {
      const used = Number(item.used) || 0;
      const budget = Number(item.budget) || 1;
      const pct = Math.min(100, Math.round((used / budget) * 100));
      const c = budgetColor(pct);
      return { key: idx, item, used, budget, pct, c };
    }), [budgetData]);

  const predictionItems = useMemo(() =>
    predictionData.map((p: any, idx: number) => {
      const sc = statusColorsMap[p.status] || statusColorsMap.normal;
      const tagColor = tagColorMap[p.status] || 'processing';
      const label = statusLabelMap[p.status] || '正常';
      return { key: idx, p, sc, tagColor, label };
    }), [predictionData]);

  const handleItemClick = useCallback((id: number) => {
    navigate(`/reimbursements/${id}`);
  }, [navigate]);

  const handleMouseEnter = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    (e.currentTarget as HTMLDivElement).style.background = 'rgba(79,70,229,0.1)';
  }, []);

  const handleMouseLeave = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    (e.currentTarget as HTMLDivElement).style.background = 'transparent';
  }, []);

  return (
    <div style={s.page}>
      <div style={s.cockpit}>
        <div style={s.glowTop} />
        <div style={s.glowBottom} />

        <div style={s.inner}>
          {/* ====== 标题栏 ====== */}
          <div style={s.titleBar}>
            <div style={s.titleLeft}>
              <div style={s.iconBox}>
                <RobotOutlined style={{ fontSize: 24, color: '#fff' }} />
              </div>
              <div>
                <h1 style={s.h1}>财务智能决策驾驶舱</h1>
                <p style={s.subtitle}>Financial AI Decision Cockpit · 数据每 30 秒自动刷新</p>
              </div>
            </div>
            <Tag color="processing" style={s.tagRealTime}>
              <ClockCircleOutlined /> 实时监控中
            </Tag>
          </div>

          {/* ====== KPI 卡片 ====== */}
          <Row gutter={[16, 16]} style={s.kpiRow}>
            {kpiDefs.map((k, i) => (
              <Col span={6} key={i}>
                <Card style={{ ...s.card, background: k.grad }}>
                  <Statistic
                    title={<span style={s.statTitle}>{k.label}</span>}
                    value={i === 0 ? invoiceCount : i === 1 ? totalAmount.toFixed(2) : i === 2 ? `${approvalRate.toFixed(1)}` : aiRejectCount}
                    suffix={k.suffix}
                    valueStyle={s.statValue}
                    prefix={k.isCurrency
                      ? <span style={s.currencyPrefix}>¥</span>
                      : <k.Icon style={s.iconPrefix} />}
                  />
                </Card>
              </Col>
            ))}
          </Row>

          {/* ====== 中排 ====== */}
          <Row gutter={[16, 16]}>
            <Col span={14}>
              <Card
                title={<span style={{ color: '#fff' }}>📈 近 12 个月报销金额趋势</span>}
                style={s.cardBase}
                styles={{ header: s.cardHead }}
              >
                <div key={trendChartKey} style={s.chartWrap}>
                  {trendData.length > 0
                    ? <Area {...(trendAreaConfig as any)} />
                    : <Empty description={<span style={s.emptyDesc}>暂无数据</span>} image={Empty.PRESENTED_IMAGE_SIMPLE} />}
                </div>
              </Card>
            </Col>
            <Col span={10}>
              <Card
                title={<span style={{ color: '#fff' }}>💰 项目预算消耗排行</span>}
                style={s.cardBase}
                styles={{ header: s.cardHead }}
              >
                <div style={s.budgetList}>
                  {budgetItems.length === 0 ? (
                    <Empty description={<span style={s.emptyDesc}>暂无项目数据</span>} image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  ) : (
                    budgetItems.map(({ key, item, used, budget, pct, c }) => (
                      <div key={key} style={s.budgetItem}>
                        <div style={s.budgetItemTop}>
                          <span style={s.budgetItemName}>{item.project_name || item.project_code}</span>
                          <span style={{ color: c, fontWeight: 700, fontSize: 14 }}>{pct}%</span>
                        </div>
                        <div style={s.budgetTrack}>
                          <div style={{ width: `${pct}%`, height: '100%', background: c, borderRadius: 999, transition: 'width .4s ease' }} />
                        </div>
                        <div style={s.budgetItemBottom}>
                          <span>已使用 ¥{used.toLocaleString()}</span>
                          <span>预算 ¥{budget.toLocaleString()}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </Card>
            </Col>
          </Row>

          {/* ====== 预算预测 ====== */}
          {predictionData.length > 0 && (
            <Row gutter={[16, 16]} style={s.sectionRow}>
              <Col span={14}>
                <Card
                  title={<span style={{ color: '#fff' }}>🔮 预算耗尽预测（GM(1,1)+Markov 组合模型）</span>}
                  style={s.cardBase}
                  styles={{ header: s.cardHead }}
                >
                  <div key={predictionChartKey} style={s.chartWrap}>
                    {predictionFlatData.length > 0
                      ? <Area {...(predictionAreaConfig as any)} />
                      : <Empty description={<span style={s.emptyDesc}>预测数据加载中...</span>} image={Empty.PRESENTED_IMAGE_SIMPLE} />}
                  </div>
                </Card>
              </Col>
              <Col span={10}>
                <Card
                  title={<span style={{ color: '#fff' }}>⚠️ 预算预警面板</span>}
                  style={{ ...s.cardBase, height: '100%' }}
                  styles={{ header: s.cardHead, body: s.warningPanelBody }}
                >
                  {predictionItems.length === 0 ? (
                    <Empty description={<span style={s.emptyDesc}>暂无预测数据</span>} image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  ) : (
                    predictionItems.map(({ key, p, sc, tagColor, label }) => (
                      <div key={key} style={{ ...s.warningCard, background: sc.bg, borderLeft: `3px solid ${sc.tag}` }}>
                        <div style={s.warningTitle}>
                          <span style={s.warningProjectName}>{sc.icon} {p.project_name || p.project_code}</span>
                          <Tag color={tagColor} style={{ fontSize: 11 }}>{label}</Tag>
                        </div>
                        <div style={s.warningDetail}>
                          <div>预算: ¥{Number(p.budget).toLocaleString()} | 已用: ¥{Number(p.spent).toLocaleString()}</div>
                          {p.status !== 'insufficient_data' && p.status !== 'exhausted' && (
                            <>
                              <div>月均消耗: ¥{Number(p.monthly_burn_rate || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
                              <div style={{ color: p.days_remaining <= 30 ? '#F43F5E' : p.days_remaining <= 90 ? '#F59E0B' : 'rgba(255,255,255,0.6)' }}>
                                {typeof p.days_remaining === 'number' && p.days_remaining < 9999
                                  ? `预计 ${p.days_remaining} 天后耗尽 · ${p.predicted_exhaustion_date}`
                                  : '短期内不会耗尽'}
                              </div>
                            </>
                          )}
                          {p.status === 'exhausted' && <div style={{ color: '#F43F5E' }}>预算已耗尽！请立即调整支出策略</div>}
                          {p.status === 'insufficient_data' && <div>数据不足，需要至少3条报销记录才能预测</div>}
                          {p.gm11_quality != null && p.status !== 'insufficient_data' && (
                            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>GM(1,1) 拟合误差: {p.gm11_quality}%</div>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </Card>
              </Col>
            </Row>
          )}

          {/* ====== 底排 ====== */}
          <Row gutter={[16, 16]} style={s.sectionRow}>
            <Col span={10}>
              <Card
                title={<span style={{ color: '#fff' }}><SafetyCertificateOutlined style={{ color: colors.violet, marginRight: 6 }} /> AI 风险评级分布</span>}
                style={s.cardBase}
                styles={{ header: s.cardHead }}
              >
                <div key={pieChartKey} style={s.chartWrapSmall}>
                  {pieData.length > 0
                    ? <Pie {...(pieConfig as any)} />
                    : <Empty description={<span style={s.emptyDesc}>暂无审查数据</span>} image={Empty.PRESENTED_IMAGE_SIMPLE} />}
                </div>
              </Card>
            </Col>
            <Col span={14}>
              <Card
                title={<span style={{ color: '#fff' }}>📋 待审批报销单 <Tag color="warning">{pendingList.length} 笔</Tag></span>}
                style={s.cardBase}
                styles={{ header: s.cardHead, body: { padding: 0 } }}
              >
                <div style={s.pendingList}>
                  {pendingList.length === 0 ? (
                    <Empty description={<span style={s.emptyDesc}>暂无待审批报销单</span>} image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: '40px 0' }} />
                  ) : (
                    <List
                      dataSource={pendingList}
                      renderItem={(item: any) => (
                        <List.Item
                          onClick={() => handleItemClick(item.id)}
                          style={s.listItem}
                          onMouseEnter={handleMouseEnter}
                          onMouseLeave={handleMouseLeave}
                        >
                          <List.Item.Meta
                            title={<span style={s.listItemTitle}>#{item.id} {item.title}</span>}
                            description={<span style={s.listItemDesc}>
                              {item.submitter} · {item.created_at ? new Date(item.created_at).toLocaleString() : ''}
                            </span>}
                          />
                          <Tag color="warning" style={{ fontWeight: 600 }}>¥{Number(item.amount).toFixed(2)}</Tag>
                        </List.Item>
                      )}
                    />
                  )}
                </div>
              </Card>
            </Col>
          </Row>
        </div>
      </div>
    </div>
  );
}