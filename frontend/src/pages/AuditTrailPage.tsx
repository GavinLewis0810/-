import { useState, useEffect, useCallback } from 'react';
import {
  Card, Table, Tag, Row, Col, Statistic, Select, DatePicker,
  Input, Button, Space, Steps, Spin, Tooltip, Popover,
} from 'antd';
import {
  SearchOutlined, ReloadOutlined, AuditOutlined,
  ClockCircleOutlined, FileTextOutlined, SendOutlined,
  CheckOutlined, DollarOutlined, UnorderedListOutlined,
} from '@ant-design/icons';
import { getAuditLogs, getAuditStats, getFlowStats } from '../services/api';
import type { AuditLogItem, AuditStats as AuditStatsType, FlowStat } from '../types/invoice';

const { RangePicker } = DatePicker;

const entityLabels: Record<string, string> = {
  invoice: '发票', parsing_diff: '解析差异', reimbursement: '报销单',
};

const actionLabels: Record<string, string> = {
  create: '创建', upload: '上传', process_complete: 'OCR/LLM解析', confirm: '确认',
  update: '修改', delete: '删除', resolve: '解决差异',
  submit: '提交报销', approve: '审批通过', reject: '驳回',
  complete: '完成打款',
};

const actionColors: Record<string, string> = {
  create: 'blue', upload: 'blue', process_complete: 'processing', confirm: 'green',
  update: 'orange', delete: 'red', resolve: 'cyan',
  submit: 'blue', approve: 'green', reject: 'red',
  complete: 'purple',
  
};

function fmtTime(minutes: number): string {
  if (minutes <= 0) return '暂无数据';
  if (minutes < 1) return '< 1分钟';
  if (minutes < 60) return `${Math.round(minutes)}分钟`;
  return `${(minutes / 60).toFixed(1)}小时`;
}

function AuditTrailPage() {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<AuditStatsType | null>(null);
  const [flow, setFlow] = useState<FlowStat | null>(null);

  // 筛选
  const [filterAction, setFilterAction] = useState<string | undefined>();
  const [filterEntity, setFilterEntity] = useState<string | undefined>();
  const [filterUser, setFilterUser] = useState('');
  const [dateRange, setDateRange] = useState<[string, string] | null>(null);

  const fetchLogs = useCallback(async (pg = 1) => {
    setLoading(true);
    try {
      const res = await getAuditLogs({
        page: pg, page_size: 20,
        entity_type: filterEntity || undefined,
        action: filterAction || undefined,
        user_id: filterUser || undefined,
        date_from: dateRange?.[0],
        date_to: dateRange?.[1],
      });
      setLogs(res.items);
      setTotal(res.total);
      setPage(pg);
    } catch { /* silent */ }
    setLoading(false);
  }, [filterAction, filterEntity, filterUser, dateRange]);

  const fetchStats = useCallback(async () => {
    try {
      const [s, f] = await Promise.all([getAuditStats(), getFlowStats()]);
      setStats(s);
      setFlow(f);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { fetchLogs(1); fetchStats(); }, [fetchLogs, fetchStats]);

  const columns = [
    {
      title: '时间', dataIndex: 'created_at', key: 'time', width: 160,
      render: (v: string) => new Date(v).toLocaleString(),
    },
    {
      title: '操作人', dataIndex: 'user_id', key: 'user', width: 100,
      render: (v: string) => v || '-',
    },
    {
      title: 'IP', dataIndex: 'ip_address', key: 'ip', width: 120,
      render: (v: string) => v || '-',
    },
    {
      title: '实体', dataIndex: 'entity_type', key: 'entity', width: 100,
      render: (v: string, r: AuditLogItem) => (
        <Tag>{entityLabels[v] || v} #{r.entity_id}</Tag>
      ),
    },
    {
      title: '动作', dataIndex: 'action', key: 'action', width: 90,
      render: (v: string) => (
        <Tag color={actionColors[v] || 'default'}>{actionLabels[v] || v}</Tag>
      ),
    },
    {
      title: '变更详情', key: 'diff', ellipsis: true,
      render: (_: any, r: AuditLogItem) => {
        if (!r.old_value && !r.new_value) return '-';
        const content = (
          <div style={{ maxWidth: 350, fontSize: 12 }}>
            {r.old_value && <div style={{ color: '#ff4d4f' }}>旧: {JSON.stringify(r.old_value)}</div>}
            {r.new_value && <div style={{ color: '#52c41a' }}>新: {JSON.stringify(r.new_value)}</div>}
          </div>
        );
        return (
          <Popover content={content} title="变更明细">
            <Button type="link" size="small">查看详情</Button>
          </Popover>
        );
      },
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <h2>
        <AuditOutlined style={{ marginRight: 8, color: '#1677ff' }} />
        操作审计与流程洞察
      </h2>

      {/* 统计卡片 */}
      {stats && (
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={4}>
            <Card size="small">
              <Statistic title="今日操作" value={stats.today_count} prefix={<ClockCircleOutlined />} />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic title="本月操作" value={stats.month_count} prefix={<UnorderedListOutlined />} />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic
                title="OCR/LLM解析" value={
                  (stats.by_action.find(a => a.action === 'process_complete')?.count || 0)
                } prefix={<FileTextOutlined />} />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic
                title="发票确认" value={
                  (stats.by_action.find(a => a.action === 'confirm')?.count || 0)
                } prefix={<CheckOutlined />} />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic
                title="当前待审批" value={flow?.pending_count || 0}
                valueStyle={{ color: (flow?.pending_count || 0) > 0 ? '#faad14' : undefined }}
                prefix={<SendOutlined />} />
            </Card>
          </Col>
          <Col span={4}>
            <Card size="small">
              <Statistic
                title="平均全流程耗时" value={flow ? fmtTime(flow.avg_total_minutes) : '-'}
                prefix={<ClockCircleOutlined />} />
            </Card>
          </Col>
        </Row>
      )}

      {/* 审批流程耗时 */}
      {flow && (
        <Card size="small" style={{ marginBottom: 16 }}>
          <Row align="middle">
            <Col span={20}>
              <Steps
                size="small"
                current={2}
                items={[
                  { title: '提交报销', description: '员工提交', icon: <SendOutlined /> },
                  { title: '审批通过', description: fmtTime(flow.latest_submit_to_approve_minutes), icon: <CheckOutlined /> },
                  { title: '打款完成', description: fmtTime(flow.latest_approve_to_pay_minutes), icon: <DollarOutlined style={{ color: '#52c41a' }} /> },
                ]}
              />
            </Col>
            <Col span={4} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 'bold', color: '#1677ff' }}>
                {flow.latest_total_minutes > 0 ? `#${flow.latest_reimb_id} 全流程 ${fmtTime(flow.latest_total_minutes)}` : '暂无完整流程'}
              </div>
              <div style={{ fontSize: 11, color: '#999' }}>
                近30天均值 · 提交→审批 {fmtTime(flow.avg_submit_to_approve_minutes)} · 审批→打款 {fmtTime(flow.avg_approve_to_pay_minutes)}
              </div>
            </Col>
          </Row>
        </Card>
      )}

      {/* 筛选栏 */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          <RangePicker
            size="small"
            onChange={(_, dateStrings) => {
              if (dateStrings?.[0] && dateStrings?.[1]) {
                setDateRange([dateStrings[0], dateStrings[1]]);
              } else {
                setDateRange(null);
              }
            }}
          />
          <Select
            size="small" placeholder="操作类型" allowClear style={{ width: 120 }}
            value={filterAction} onChange={setFilterAction}
            options={Object.entries(actionLabels).map(([k, v]) => ({ value: k, label: v }))}
          />
          <Select
            size="small" placeholder="实体类型" allowClear style={{ width: 110 }}
            value={filterEntity} onChange={setFilterEntity}
            options={Object.entries(entityLabels).map(([k, v]) => ({ value: k, label: v }))}
          />
          <Input
            size="small" placeholder="操作人" allowClear style={{ width: 120 }}
            value={filterUser} onChange={e => setFilterUser(e.target.value)}
            prefix={<SearchOutlined />}
          />
          <Button size="small" icon={<ReloadOutlined />} onClick={() => {
            setFilterAction(undefined); setFilterEntity(undefined);
            setFilterUser(''); setDateRange(null);
          }}>重置</Button>
        </Space>
      </Card>

      {/* 日志表格 */}
      <Card>
        <Table
          dataSource={logs}
          columns={columns}
          rowKey="id"
          loading={loading}
          size="small"
          pagination={{
            current: page, total, pageSize: 20, showTotal: (t) => `共 ${t} 条`,
            onChange: (pg) => fetchLogs(pg),
          }}
        />
      </Card>
    </div>
  );
}

export default AuditTrailPage;
