import { useEffect, useState, useRef } from 'react';
import { Row, Col, Card, Statistic, Empty, Tag, List } from 'antd';
import {
  FileDoneOutlined, AccountBookOutlined, CheckCircleOutlined,
  SafetyCertificateOutlined, RobotOutlined, ClockCircleOutlined,
} from '@ant-design/icons';
import { Line, Pie, Bar } from '@ant-design/plots';
import { getDashboardStats, getBudgetPrediction } from '../services/api';
import { useNavigate } from 'react-router-dom';

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

  const fetchAll = async () => {
    try {
      const chartRes = await getDashboardStats();
      setInvoiceCount(chartRes.reimbursedInvoiceCount || 0);
      setTotalAmount(chartRes.totalReimbursedAmount || 0);
      setApprovalRate(chartRes.approvalRate || 0);
      setAiRejectCount(chartRes.aiRejectCount || 0);
      setTrendData(chartRes.trendData || []);
      setPieData(chartRes.pieData || []);
      setBudgetData(chartRes.budgetData || []);
      setPendingList(chartRes.pendingList || []);
      try {
        const predRes = await getBudgetPrediction();
        setPredictionData(predRes.predictions || []);
      } catch { /* prediction fetch is non-blocking */ }
    } catch { /* silent */ }
  };

  useEffect(() => {
    fetchAll();
    timerRef.current = setInterval(fetchAll, 30000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const lineConfig = {
    data: trendData,
    xField: 'month', yField: 'value', seriesField: 'type',
    smooth: true, theme: 'dark' as const,
    color: ['#E42313', '#1677ff', '#52c41a', '#faad14'],
    legend: { layout: 'horizontal' as const, position: 'top' as const },
    point: { size: 3 },
  };

  const budgetBarConfig = (() => {
    const flatData: any[] = [];
    (Array.isArray(budgetData) ? budgetData : []).forEach((b: any) => {
      let rawName = b.project_name || b.project_code || '未知项目';
      if (typeof rawName === 'object') rawName = rawName.name || rawName.title || String(rawName);
      rawName = String(rawName);
      const shortName = rawName.length > 7 ? rawName.slice(0, 7) + '...' : rawName;
      const used = Number(b.used) || 0;
      const budget = Number(b.budget) || 0;
      const remaining = Number(b.remaining) || 0;
      flatData.push({ name: shortName, fullName: rawName, type: '已使用', value: used, budget });
      flatData.push({ name: shortName, fullName: rawName, type: '预算余额', value: Math.max(0, remaining), budget });
    });
    return {
      data: flatData,
      xField: 'name', yField: 'value', seriesField: 'type',
      stack: true, maxBarWidth: 24,
      color: ['#1677ff', 'rgba(255,255,255,0.08)'],
      label: {
        position: 'middle' as const,
        text: (d: any) => (d.type === '已使用' && d.value > 0 ? `¥${(d.value / 10000).toFixed(1)}万` : ''),
        style: { fill: '#fff', fontSize: 11, fontWeight: 'bold' as const },
      },
      tooltip: {
        title: (d: any) => d.fullName || d.name,
        formatter: (d: any) => {
          const pct = d.budget > 0 ? ((d.value / d.budget) * 100).toFixed(1) : '0';
          return { name: d.type, value: `¥${d.value.toLocaleString()} (${pct}%)` };
        },
      },
      axis: {
        x: { style: { labelFontSize: 12, labelFill: 'rgba(255,255,255,0.85)' } },
        y: {
  nice: true,
  tickInterval: (() => {
    const maxVal = Math.max(
      ...flatData.map((d: any) => d.budget || 0),
      1
    );
    const rough = maxVal / 5;
    const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
    const normalized = rough / magnitude;
    const step = normalized < 1.5 ? 1
      : normalized < 3.5 ? 2
      : normalized < 7.5 ? 5
      : 10;
    return step * magnitude;
  })(),
  labelFormatter: (v: number) => {
    if (v === 0) return '0';
    if (v >= 100_000_000) return `${(v / 100_000_000).toFixed(1)}亿`;
    if (v >= 10_000) return `${(v / 10_000).toFixed(v % 10_000 === 0 ? 0 : 1)}万`;
    return `${v}`;
  },
  style: { labelFill: 'rgba(255,255,255,0.45)' },
  grid: { line: { style: { stroke: 'rgba(255,255,255,0.05)' } } },
},
      },
    };
  })();

  const pieConfig = {
    data: pieData,
    angleField: 'value', colorField: 'type',
    radius: 0.8, innerRadius: 0.65, theme: 'dark' as const,
    color: ['#E42313', '#faad14', '#52c41a', '#1677ff'],
    label: { text: 'value', style: { fontWeight: 'bold' as const, fontSize: 14 } },
    legend: { layout: 'horizontal' as const, position: 'bottom' as const },
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{
        background: '#0a0e27', borderRadius: 16, padding: 24,
        boxShadow: '0 4px 24px rgba(0,0,0,0.15)',
      }}>
      {/* ====== 标题栏 ====== */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <RobotOutlined style={{ fontSize: 32, color: '#E42313' }} />
          <div>
            <h1 style={{ color: '#fff', margin: 0, fontSize: 24, fontWeight: 700 }}>财务智能决策驾驶舱</h1>
            <p style={{ color: 'rgba(255,255,255,0.45)', margin: '4px 0 0', fontSize: 13 }}>Financial AI Decision Cockpit · 数据每 30 秒自动刷新</p>
          </div>
        </div>
        <Tag color="processing" style={{ fontSize: 13, padding: '4px 12px' }}>
          <ClockCircleOutlined /> 实时监控中
        </Tag>
      </div>

      {/* ====== 顶部 KPI 卡片 ====== */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card style={{ background: 'linear-gradient(135deg, #1677ff 0%, #0958d9 100%)', border: 'none', borderRadius: 10 }}>
            <Statistic title={<span style={{ color: 'rgba(255,255,255,0.75)' }}>累计处理发票</span>}
              value={invoiceCount} suffix="张"
              valueStyle={{ color: '#fff', fontSize: 36, fontWeight: 700 }}
              prefix={<FileDoneOutlined style={{ color: 'rgba(255,255,255,0.6)', marginRight: 8 }} />} />
          </Card>
        </Col>
        <Col span={6}>
          <Card style={{ background: 'linear-gradient(135deg, #52c41a 0%, #389e0d 100%)', border: 'none', borderRadius: 10 }}>
            <Statistic title={<span style={{ color: 'rgba(255,255,255,0.75)' }}>报销总金额</span>}
              value={totalAmount} precision={2}
              valueStyle={{ color: '#fff', fontSize: 36, fontWeight: 700 }}
              prefix={<AccountBookOutlined style={{ color: 'rgba(255,255,255,0.6)', marginRight: 8 }} />}
              suffix={<span style={{ fontSize: 20, color: 'rgba(255,255,255,0.7)' }}>¥</span>} />
          </Card>
        </Col>
        <Col span={6}>
          <Card style={{ background: 'linear-gradient(135deg, #faad14 0%, #d48806 100%)', border: 'none', borderRadius: 10 }}>
            <Statistic title={<span style={{ color: 'rgba(255,255,255,0.75)' }}>审批通过率</span>}
              value={approvalRate} suffix="%" precision={1}
              valueStyle={{ color: '#fff', fontSize: 36, fontWeight: 700 }}
              prefix={<CheckCircleOutlined style={{ color: 'rgba(255,255,255,0.6)', marginRight: 8 }} />} />
          </Card>
        </Col>
        <Col span={6}>
          <Card style={{ background: 'linear-gradient(135deg, #E42313 0%, #a8071a 100%)', border: 'none', borderRadius: 10 }}>
            <Statistic title={<span style={{ color: 'rgba(255,255,255,0.75)' }}>AI 拦截高风险单</span>}
              value={aiRejectCount} suffix="单"
              valueStyle={{ color: '#fff', fontSize: 36, fontWeight: 700 }}
              prefix={<SafetyCertificateOutlined style={{ color: 'rgba(255,255,255,0.6)', marginRight: 8 }} />} />
          </Card>
        </Col>
      </Row>

      {/* ====== 中排：趋势折线 + 预算排行 ====== */}
      <Row gutter={[16, 16]}>
        <Col span={14}>
          <Card title={<span style={{ color: '#fff' }}>📈 近 12 个月报销金额趋势</span>}
            style={{ background: '#111633', border: 'none', borderRadius: 10 }}
            headStyle={{ borderBottom: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}>
            <div style={{ height: 320 }}>
              {trendData.length > 0 ? <Line {...(lineConfig as any)} />
                : <Empty description={<span style={{ color: '#999' }}>暂无数据</span>} image={Empty.PRESENTED_IMAGE_SIMPLE} />}
            </div>
          </Card>
        </Col>
        <Col span={10}>
          <Card title={<span style={{ color: '#fff' }}>💰 项目预算消耗排行</span>}
            style={{ background: '#111633', border: 'none', borderRadius: 10 }}
            headStyle={{ borderBottom: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}>
            <div style={{ height: 320 }}>
              {budgetData.length > 0 ? <Bar {...(budgetBarConfig as any)} />
                : <Empty description={<span style={{ color: '#999' }}>暂无项目数据</span>} image={Empty.PRESENTED_IMAGE_SIMPLE} />}
            </div>
          </Card>
        </Col>
      </Row>

      {/* ====== 预算耗尽预测 ====== */}
      {predictionData.length > 0 && (
        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col span={14}>
            <Card
              title={<span style={{ color: '#fff' }}>🔮 预算耗尽预测（GM(1,1)+Markov 组合模型）</span>}
              style={{ background: '#111633', border: 'none', borderRadius: 10 }}
              headStyle={{ borderBottom: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}
            >
              <div style={{ height: 340 }}>
                <Line
                  {...({
                    data: predictionData.flatMap((p: any) =>
                      (p.cumulative_data || []).map((d: any) => ({
                        date: d.date,
                        amount: d.amount,
                        project: (p.project_name || p.project_code || '未知').length > 8
                          ? (p.project_name || p.project_code || '未知').slice(0, 8) + '...'
                          : (p.project_name || p.project_code || '未知'),
                        type: d.type,
                        budget: p.budget,
                      }))
                    ),
                    xField: 'date',
                    yField: 'amount',
                    seriesField: 'project',
                    smooth: false,
                    theme: 'dark' as const,
                    color: ['#1677ff', '#52c41a', '#faad14', '#E42313', '#722ed1', '#13c2c2'],
                    legend: { layout: 'horizontal' as const, position: 'top' as const },
                    point: {
                      size: 3,
                      shape: 'circle',
                    },
                    tooltip: {
                      title: (d: any) => `${d.date}`,
                      formatter: (d: any) => ({
                        name: `${d.project} (${d.type === 'predicted' ? '预测' : '实际'})`,
                        value: `¥${Number(d.amount).toLocaleString()}`,
                      }),
                    },
                    axis: {
                      x: {
                        label: { autoRotate: true, autoHide: true, style: { fill: 'rgba(255,255,255,0.65)', fontSize: 11 } },
                        grid: { line: { style: { stroke: 'rgba(255,255,255,0.04)' } } },
                      },
                      y: {
                        label: {
                          style: { fill: 'rgba(255,255,255,0.45)', fontSize: 12 },
                          formatter: (v: number) => {
                            if (v >= 10000) return `${(v / 10000).toFixed(1)}万`;
                            return `${v}`;
                          },
                        },
                        grid: { line: { style: { stroke: 'rgba(255,255,255,0.06)' } } },
                      },
                    },
                    annotations: predictionData
                      .filter((p: any) => p.budget > 0)
                      .map((p: any) => ({
                        type: 'line' as const,
                        yField: p.budget,
                        style: { stroke: 'rgba(228,35,19,0.4)', lineDash: [6, 3], lineWidth: 1 },
                        tooltip: false,
                      })),
                  } as any)}
                />
              </div>
            </Card>
          </Col>
          <Col span={10}>
            <Card
              title={<span style={{ color: '#fff' }}>⚠️ 预算预警面板</span>}
              style={{ background: '#111633', border: 'none', borderRadius: 10, height: '100%' }}
              headStyle={{ borderBottom: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}
              bodyStyle={{ padding: '0 12px 12px', maxHeight: 320, overflow: 'auto' }}
            >
              {predictionData.length === 0 ? (
                <Empty description={<span style={{ color: '#999' }}>暂无预测数据</span>} image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                predictionData.map((p: any, idx: number) => {
                  const statusColors: Record<string, { bg: string; tag: string; icon: string }> = {
                    critical: { bg: 'rgba(228,35,19,0.15)', tag: '#E42313', icon: '🔴' },
                    warning: { bg: 'rgba(250,173,20,0.15)', tag: '#faad14', icon: '🟡' },
                    normal: { bg: 'rgba(22,119,255,0.1)', tag: '#1677ff', icon: '🔵' },
                    exhausted: { bg: 'rgba(228,35,19,0.25)', tag: '#E42313', icon: '💀' },
                    insufficient_data: { bg: 'rgba(255,255,255,0.03)', tag: 'rgba(255,255,255,0.25)', icon: '⬜' },
                  };
                  const s = statusColors[p.status] || statusColors.normal;
                  return (
                    <div
                      key={idx}
                      style={{
                        background: s.bg,
                        borderRadius: 8,
                        padding: '12px 14px',
                        marginTop: 10,
                        borderLeft: `3px solid ${s.tag}`,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <span style={{ color: '#fff', fontWeight: 600, fontSize: 14 }}>
                          {s.icon} {p.project_name || p.project_code}
                        </span>
                        <Tag
                          color={
                            p.status === 'critical' || p.status === 'exhausted' ? 'error'
                            : p.status === 'warning' ? 'warning'
                            : p.status === 'insufficient_data' ? 'default'
                            : 'processing'
                          }
                          style={{ fontSize: 11 }}
                        >
                          {p.status === 'critical' ? '紧急'
                            : p.status === 'warning' ? '预警'
                            : p.status === 'exhausted' ? '已耗尽'
                            : p.status === 'insufficient_data' ? '数据不足'
                            : '正常'}
                        </Tag>
                      </div>
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', lineHeight: 1.8 }}>
                        <div>预算: ¥{Number(p.budget).toLocaleString()} | 已用: ¥{Number(p.spent).toLocaleString()}</div>
                        {p.status !== 'insufficient_data' && p.status !== 'exhausted' && (
                          <>
                            <div>月均消耗: ¥{Number(p.monthly_burn_rate || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</div>
                            <div style={{ color: p.days_remaining <= 30 ? '#E42313' : p.days_remaining <= 90 ? '#faad14' : 'rgba(255,255,255,0.6)' }}>
                              {typeof p.days_remaining === 'number' && p.days_remaining < 9999
                                ? `预计 ${p.days_remaining} 天后耗尽 · ${p.predicted_exhaustion_date}`
                                : '短期内不会耗尽'}
                            </div>
                          </>
                        )}
                        {p.status === 'exhausted' && (
                          <div style={{ color: '#E42313' }}>预算已耗尽！请立即调整支出策略</div>
                        )}
                        {p.status === 'insufficient_data' && (
                          <div>数据不足，需要至少3条报销记录才能预测</div>
                        )}
                        {p.gm11_quality != null && p.status !== 'insufficient_data' && (
                          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>
                            GM(1,1) 拟合误差: {p.gm11_quality}%
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </Card>
          </Col>
        </Row>
      )}

      {/* ====== 底排：风险饼图 + 待审批列表 ====== */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col span={10}>
          <Card title={<span style={{ color: '#fff' }}><SafetyCertificateOutlined style={{ color: '#E42313' }} /> AI 风险评级分布</span>}
            style={{ background: '#111633', border: 'none', borderRadius: 10 }}
            headStyle={{ borderBottom: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}>
            <div style={{ height: 300 }}>
              {pieData.length > 0 ? <Pie {...(pieConfig as any)} />
                : <Empty description={<span style={{ color: '#999' }}>暂无审查数据</span>} image={Empty.PRESENTED_IMAGE_SIMPLE} />}
            </div>
          </Card>
        </Col>
        <Col span={14}>
          <Card title={<span style={{ color: '#fff' }}>📋 待审批报销单 <Tag color="warning">{pendingList.length} 笔</Tag></span>}
            style={{ background: '#111633', border: 'none', borderRadius: 10 }}
            headStyle={{ borderBottom: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}
            bodyStyle={{ padding: 0 }}>
            <div style={{ maxHeight: 300, overflow: 'auto' }}>
              {pendingList.length === 0 ? (
                <Empty description={<span style={{ color: '#999' }}>暂无待审批报销单</span>} image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: '40px 0' }} />
              ) : (
                <List
                  dataSource={pendingList}
                  renderItem={(item: any) => (
                    <List.Item
                      onClick={() => navigate(`/reimbursements/${item.id}`)}
                      style={{ padding: '12px 20px', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(228,35,19,0.1)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <List.Item.Meta
                        title={<span style={{ color: '#fff', fontWeight: 500 }}>#{item.id} {item.title}</span>}
                        description={<span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>
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
  );
}
