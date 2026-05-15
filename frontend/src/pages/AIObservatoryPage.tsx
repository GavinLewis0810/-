import { useEffect, useState, useRef } from 'react';
import { Row, Col, Card, Statistic, Table, Tag } from 'antd';
import {
  DashboardOutlined,
  ScanOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  ApiOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  WarningOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { Line, Funnel } from '@ant-design/plots';
import { getObservabilityStats } from '../services/api';
import type { ObservabilityStats, LogEntry } from '../services/api';

// ===================== Fallback Mock Data =====================

const MOCK_KPI = {
  daily_calls: 12450,
  daily_calls_change: 5.2,
  ocr_avg_latency_ms: 1200,
  llm_avg_latency_ms: 3500,
  hitl_rate: 4.2,
};

const generateMockLine = () => {
  const data: any[] = [];
  for (let i = 0; i < 24; i++) {
    const hour = `${String(i).padStart(2, '0')}:00`;
    data.push({ time: hour, category: 'OCR 引擎延迟', value: 800 + Math.round(Math.random() * 700) });
    data.push({ time: hour, category: 'LLM 引擎延迟', value: 2000 + Math.round(Math.random() * 3500) });
  }
  return data;
};

const MOCK_FUNNEL = [
  { stage: '总单据流入', count: 12450 },
  { stage: 'OCR 初步提取', count: 11800 },
  { stage: 'LLM 语义校验比对', count: 10500 },
  { stage: '双引擎一致通过', count: 9800 },
];

const MOCK_LOGS: LogEntry[] = [
  { key: '1', timestamp: '2026-05-12 14:32:01', requestId: 'req-a8f3b2c1', engine: 'OCR', status: 'success', duration: 1120 },
  { key: '2', timestamp: '2026-05-12 14:31:58', requestId: 'req-d4e5f6a7', engine: 'LLM', status: 'success', duration: 3840 },
  { key: '3', timestamp: '2026-05-12 14:31:55', requestId: 'req-1a2b3c4d', engine: 'OCR', status: 'success', duration: 980 },
  { key: '4', timestamp: '2026-05-12 14:31:50', requestId: 'req-9f8e7d6c', engine: 'LLM', status: 'degraded', duration: 7820 },
  { key: '5', timestamp: '2026-05-12 14:31:42', requestId: 'req-5b4a3c2d', engine: 'OCR', status: 'success', duration: 1340 },
  { key: '6', timestamp: '2026-05-12 14:31:38', requestId: 'req-7e6f5g4h', engine: 'LLM', status: 'success', duration: 2950 },
  { key: '7', timestamp: '2026-05-12 14:31:33', requestId: 'req-3i2j1k0l', engine: 'OCR', status: 'success', duration: 870 },
  { key: '8', timestamp: '2026-05-12 14:31:28', requestId: 'req-8m9n0o1p', engine: 'LLM', status: 'circuit_break', duration: 30120 },
  { key: '9', timestamp: '2026-05-12 14:31:20', requestId: 'req-2q3r4s5t', engine: 'OCR', status: 'success', duration: 1050 },
  { key: '10', timestamp: '2026-05-12 14:31:15', requestId: 'req-6u7v8w9x', engine: 'LLM', status: 'success', duration: 4120 },
  { key: '11', timestamp: '2026-05-12 14:31:10', requestId: 'req-0y1z2a3b', engine: 'OCR', status: 'degraded', duration: 4520 },
  { key: '12', timestamp: '2026-05-12 14:31:05', requestId: 'req-4c5d6e7f', engine: 'LLM', status: 'success', duration: 2680 },
  { key: '13', timestamp: '2026-05-12 14:31:01', requestId: 'req-8g9h0i1j', engine: 'OCR', status: 'success', duration: 1150 },
  { key: '14', timestamp: '2026-05-12 14:30:55', requestId: 'req-2k3l4m5n', engine: 'LLM', status: 'degraded', duration: 6540 },
  { key: '15', timestamp: '2026-05-12 14:30:48', requestId: 'req-6o7p8q9r', engine: 'OCR', status: 'success', duration: 920 },
];

// ===================== Component =====================

export default function AIObservatoryPage() {
  const [stats, setStats] = useState<ObservabilityStats | null>(null);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStats = async () => {
    try {
      const data = await getObservabilityStats();
      setStats(data);
    } catch {
      // Use mock data as fallback
      setStats({
        kpi: MOCK_KPI,
        line_data: generateMockLine(),
        funnel_data: MOCK_FUNNEL,
        recent_logs: MOCK_LOGS,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    timerRef.current = setInterval(fetchStats, 30000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const kpi = stats?.kpi ?? MOCK_KPI;
  const lineData = stats?.line_data ?? [];
  const funnelData = stats?.funnel_data ?? MOCK_FUNNEL;
  const logData = stats?.recent_logs ?? MOCK_LOGS;

  // ---------- derived display values ----------

  const ocrLatencySec = (kpi.ocr_avg_latency_ms / 1000).toFixed(1);
  const llmLatencySec = (kpi.llm_avg_latency_ms / 1000).toFixed(1);
  const ocrStatus = kpi.ocr_avg_latency_ms < 2000 ? 'normal' : kpi.ocr_avg_latency_ms < 5000 ? 'busy' : 'slow';
  const llmStatus = kpi.llm_avg_latency_ms < 5000 ? 'normal' : kpi.llm_avg_latency_ms < 10000 ? 'busy' : 'slow';
  const hitlColor = kpi.hitl_rate < 10 ? '#52c41a' : kpi.hitl_rate < 25 ? '#faad14' : '#e42313';

  // ---------- chart configs ----------

  const lineConfig = {
    data: lineData,
    xField: 'time',
    yField: 'value',
    seriesField: 'category',
    smooth: true,
    theme: 'dark' as const,
    color: ['#1677ff', '#722ed1'],
    legend: {
      layout: 'horizontal' as const,
      position: 'top' as const,
      itemName: { style: { fill: 'rgba(255,255,255,0.85)' } },
    },
    point: { size: 2, style: { fillOpacity: 0.8 } },
    axis: {
      x: {
        label: { style: { fill: 'rgba(255,255,255,0.45)', fontSize: 11 } },
        grid: { line: { style: { stroke: 'rgba(255,255,255,0.04)' } } },
        tickLine: null,
      },
      y: {
        title: '响应时间 (ms)',
        titleStyle: { fill: 'rgba(255,255,255,0.45)', fontSize: 12 },
        label: { style: { fill: 'rgba(255,255,255,0.45)', fontSize: 11 } },
        grid: { line: { style: { stroke: 'rgba(255,255,255,0.06)' } } },
      },
    },
    tooltip: { shared: true, showCrosshairs: true },
  };

  const funnelConfig = {
    data: funnelData,
    xField: 'stage',
    yField: 'count',
    theme: 'dark' as const,
    color: ['#1677ff', '#597ef7', '#9254de', '#52c41a'],
    label: {
      text: (d: any) => `${d.stage}\n${d.count.toLocaleString()} 单`,
      style: { fill: '#fff', fontSize: 12, fontWeight: 500 },
    },
    legend: false,
    shape: 'funnel' as const,
  };

  // ---------- table columns ----------

  const columns = [
    {
      title: '调用时间',
      dataIndex: 'timestamp',
      key: 'timestamp',
      width: 180,
      render: (v: string) => <span style={{ color: 'rgba(255,255,255,0.65)', fontSize: 12 }}>{v}</span>,
    },
    {
      title: '请求 ID',
      dataIndex: 'requestId',
      key: 'requestId',
      width: 220,
      render: (v: string) => <code style={{ color: '#1677ff', fontSize: 12 }}>{v}</code>,
    },
    {
      title: '触发引擎',
      dataIndex: 'engine',
      key: 'engine',
      width: 100,
      render: (v: string) => (
        <Tag color={v === 'OCR' ? 'blue' : 'purple'} style={{ fontSize: 12, margin: 0 }}>{v}</Tag>
      ),
    },
    {
      title: '处理状态',
      dataIndex: 'status',
      key: 'status',
      width: 150,
      render: (v: string) => {
        const map: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
          success: { color: '#52c41a', icon: <CheckCircleOutlined />, label: '成功' },
          degraded: { color: '#faad14', icon: <WarningOutlined />, label: '超时降级' },
          circuit_break: { color: '#e42313', icon: <CloseCircleOutlined />, label: 'API 熔断' },
        };
        const m = map[v] || map.success;
        return <span style={{ color: m.color, fontSize: 12 }}>{m.icon} {m.label}</span>;
      },
    },
    {
      title: '耗时 (ms)',
      dataIndex: 'duration',
      key: 'duration',
      width: 120,
      sorter: (a: any, b: any) => a.duration - b.duration,
      render: (v: number) => {
        const color = v < 2000 ? '#52c41a' : v < 6000 ? '#faad14' : '#e42313';
        return <span style={{ color, fontWeight: 600, fontSize: 13 }}>{v.toLocaleString()}</span>;
      },
    },
  ];

  // ---------- render ----------

  return (
    <div style={{ 
      padding: '24px 48px', 
      margin: '16px',                     // 留出外边距显示大圆角
      background: '#0a0e27', 
      minHeight: 'calc(100vh - 32px)',    // 动态减去外边距高度
      borderRadius: '24px',               // ✨ 四周圆角
      overflow: 'hidden',                 // ✨ 关键截断
      boxShadow: '0 8px 32px rgba(0,0,0,0.3)' // 加个阴影更立体
    }}>

      {/* ===== 页头 ===== */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <DashboardOutlined style={{ fontSize: 28, color: '#1677ff' }} />
          <div>
            <h1 style={{ color: '#fff', margin: 0, fontSize: 22, fontWeight: 700 }}>
              AI 双引擎性能监控舱
            </h1>
            <p style={{ color: 'rgba(255,255,255,0.45)', margin: '2px 0 0', fontSize: 12 }}>
              AI Observability Dashboard · OCR + LLM 双引擎实时健康监控
            </p>
          </div>
        </div>
        <Tag
          icon={<ClockCircleOutlined />}
          color={loading ? 'default' : 'processing'}
          style={{ fontSize: 12, padding: '4px 12px', borderRadius: 6 }}
        >
          {loading ? '加载中...' : '实时监控中 · 每 30s 刷新'}
        </Tag>
      </div>

      {/* ==================== 区域一：KPI 卡片 ==================== */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card style={{ background: '#111633', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8 }} bodyStyle={{ padding: '20px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <ApiOutlined style={{ fontSize: 18, color: '#1677ff' }} />
              <span style={{ color: 'rgba(255,255,255,0.65)', fontSize: 13 }}>AI 引擎日总调用量</span>
            </div>
            <Statistic
              value={kpi.daily_calls}
              valueStyle={{ color: '#fff', fontSize: 32, fontWeight: 700 }}
              suffix={<span style={{ fontSize: 16, color: 'rgba(255,255,255,0.45)' }}>次</span>}
              loading={loading}
            />
            <div style={{ marginTop: 4, color: kpi.daily_calls_change >= 0 ? '#52c41a' : '#e42313', fontSize: 12 }}>
              {kpi.daily_calls_change >= 0 ? <ArrowUpOutlined style={{ fontSize: 11 }} /> : <ArrowDownOutlined style={{ fontSize: 11 }} />}
              {' '}环比 {kpi.daily_calls_change >= 0 ? '+' : ''}{kpi.daily_calls_change}%
            </div>
          </Card>
        </Col>

        <Col span={6}>
          <Card style={{ background: '#111633', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8 }} bodyStyle={{ padding: '20px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <ScanOutlined style={{ fontSize: 18, color: ocrStatus === 'normal' ? '#52c41a' : ocrStatus === 'busy' ? '#faad14' : '#e42313' }} />
              <span style={{ color: 'rgba(255,255,255,0.65)', fontSize: 13 }}>OCR 平均解析延迟</span>
            </div>
            <Statistic
              value={ocrLatencySec}
              valueStyle={{ color: ocrStatus === 'normal' ? '#52c41a' : ocrStatus === 'busy' ? '#faad14' : '#e42313', fontSize: 32, fontWeight: 700 }}
              suffix={<span style={{ fontSize: 16, color: 'rgba(255,255,255,0.45)' }}>s</span>}
              loading={loading}
            />
            <div style={{ marginTop: 4, color: ocrStatus === 'normal' ? '#52c41a' : ocrStatus === 'busy' ? '#faad14' : '#e42313', fontSize: 12 }}>
              <CheckCircleOutlined style={{ fontSize: 11 }} />{' '}
              {ocrStatus === 'normal' ? '正常运行' : ocrStatus === 'busy' ? '繁忙状态' : '响应缓慢'}
            </div>
          </Card>
        </Col>

        <Col span={6}>
          <Card style={{ background: '#111633', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8 }} bodyStyle={{ padding: '20px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <RobotOutlined style={{ fontSize: 18, color: llmStatus === 'normal' ? '#52c41a' : llmStatus === 'busy' ? '#faad14' : '#e42313' }} />
              <span style={{ color: 'rgba(255,255,255,0.65)', fontSize: 13 }}>LLM 语义模型平均延迟</span>
            </div>
            <Statistic
              value={llmLatencySec}
              valueStyle={{ color: llmStatus === 'normal' ? '#52c41a' : llmStatus === 'busy' ? '#faad14' : '#e42313', fontSize: 32, fontWeight: 700 }}
              suffix={<span style={{ fontSize: 16, color: 'rgba(255,255,255,0.45)' }}>s</span>}
              loading={loading}
            />
            <div style={{ marginTop: 4, color: llmStatus === 'normal' ? '#52c41a' : llmStatus === 'busy' ? '#faad14' : '#e42313', fontSize: 12 }}>
              {llmStatus === 'normal' ? <CheckCircleOutlined style={{ fontSize: 11 }} /> : <WarningOutlined style={{ fontSize: 11 }} />}{' '}
              {llmStatus === 'normal' ? '正常运行' : llmStatus === 'busy' ? '繁忙状态' : '响应缓慢'}
            </div>
          </Card>
        </Col>

        <Col span={6}>
          <Card style={{ background: '#111633', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8 }} bodyStyle={{ padding: '20px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <SafetyCertificateOutlined style={{ fontSize: 18, color: '#722ed1' }} />
              <span style={{ color: 'rgba(255,255,255,0.65)', fontSize: 13 }}>HITL 降级拦截率</span>
            </div>
            <Statistic
              value={kpi.hitl_rate}
              precision={1}
              valueStyle={{ color: hitlColor, fontSize: 32, fontWeight: 700 }}
              suffix={<span style={{ fontSize: 16, color: 'rgba(255,255,255,0.45)' }}>%</span>}
              loading={loading}
            />
            <div style={{ marginTop: 4, color: hitlColor, fontSize: 12 }}>
              {kpi.hitl_rate < 10 ? <ArrowDownOutlined style={{ fontSize: 11 }} /> : <ArrowUpOutlined style={{ fontSize: 11 }} />}{' '}
              {kpi.hitl_rate < 10 ? '仅少量触发人工复核' : kpi.hitl_rate < 25 ? '部分单据需人工介入' : '需关注审核质量'}
            </div>
          </Card>
        </Col>
      </Row>

      {/* ==================== 区域二：图表行 ==================== */}
      <Row gutter={[16, 16]}>
        <Col span={16}>
          <Card
            title={
              <span style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>
                <ThunderboltOutlined style={{ color: '#1677ff', marginRight: 8 }} />
                双引擎耗时动态对比（过去 24 小时）
              </span>
            }
            style={{ background: '#111633', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8 }}
            headStyle={{ borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#fff', padding: '16px 20px' }}
            bodyStyle={{ padding: '12px 16px' }}
          >
            <div style={{ height: 360 }}>
              <Line {...(lineConfig as any)} />
            </div>
          </Card>
        </Col>

        <Col span={8}>
          <Card
            title={
              <span style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>
                <SafetyCertificateOutlined style={{ color: '#722ed1', marginRight: 8 }} />
                仲裁决议漏斗
              </span>
            }
            style={{ background: '#111633', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8 }}
            headStyle={{ borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#fff', padding: '16px 20px' }}
            bodyStyle={{ padding: '12px 16px' }}
          >
            <div style={{ height: 360 }}>
              <Funnel {...(funnelConfig as any)} />
            </div>
          </Card>
        </Col>
      </Row>

      {/* ==================== 区域三：系统健康探针日志 ==================== */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col span={24}>
          <Card
            title={
              <span style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>
                <ApiOutlined style={{ color: '#1677ff', marginRight: 8 }} />
                系统健康探针日志（System Health Probe Logs）
              </span>
            }
            style={{ background: '#111633', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8 }}
            headStyle={{ borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#fff', padding: '16px 20px' }}
            bodyStyle={{ padding: 0 }}
          >
            <Table
              dataSource={logData}
              columns={columns}
              size="small"
              loading={loading}
              pagination={{ pageSize: 10, size: 'small', showSizeChanger: false }}
              rowClassName={() => 'ai-observatory-log-row'}
              className="ai-observatory-table"
            />
          </Card>
        </Col>
      </Row>

      <style>{`
        .ai-observatory-table .ant-table {
          background: #111633 !important;
        }
        .ai-observatory-table .ant-table-thead > tr > th {
          background: rgba(22,119,255,0.10) !important;
          color: rgba(255,255,255,0.85) !important;
          font-size: 12px !important;
          font-weight: 500 !important;
          border-bottom: 1px solid rgba(255,255,255,0.08) !important;
          padding: 10px 16px !important;
        }
        .ai-observatory-table .ant-table-tbody > tr > td {
          background: #111633 !important;
          color: rgba(255,255,255,0.75) !important;
          border-bottom: 1px solid rgba(255,255,255,0.04) !important;
          padding: 9px 16px !important;
        }
        .ai-observatory-table .ant-table-tbody > tr:hover > td {
          background: rgba(22,119,255,0.08) !important;
        }
        .ai-observatory-table .ant-table-placeholder .ant-empty-description {
          color: rgba(255,255,255,0.45) !important;
        }
        .ai-observatory-table .ant-pagination {
          color: rgba(255,255,255,0.65) !important;
        }
        .ai-observatory-table .ant-pagination-item {
          background: rgba(255,255,255,0.04) !important;
          border-color: rgba(255,255,255,0.08) !important;
        }
        .ai-observatory-table .ant-pagination-item a {
          color: rgba(255,255,255,0.75) !important;
        }
        .ai-observatory-table .ant-pagination-item-active {
          background: rgba(22,119,255,0.20) !important;
          border-color: #1677ff !important;
        }
        .ai-observatory-table .ant-pagination-item-active a {
          color: #1677ff !important;
        }
        .ai-observatory-table .ant-pagination-prev button,
        .ai-observatory-table .ant-pagination-next button {
          color: rgba(255,255,255,0.65) !important;
        }
        .ai-observatory-table .ant-pagination-disabled button {
          color: rgba(255,255,255,0.25) !important;
        }
        .ai-observatory-table .ant-table-column-sorter {
          color: rgba(255,255,255,0.45) !important;
        }
      `}</style>
    </div>
  );
}