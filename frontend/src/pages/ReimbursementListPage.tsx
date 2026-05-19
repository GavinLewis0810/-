import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Col,
  Divider,
  Drawer,
  Input,
  message,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Timeline,
} from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  DollarOutlined,
  DownloadOutlined,
  EyeOutlined,
  FilterOutlined,
  RobotOutlined,
  SearchOutlined,
  ThunderboltOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  aiCheckReimbursement,
  approveReimbursement,
  completeReimbursement,
  deleteReimbursement,
  getReimbursements,
  getReimbursementTimeline,
  rejectReimbursement,
} from '../services/api';
import { InvoiceStatus, Reimbursement, ReimbursementStatus } from '../types/invoice';

type InvoiceReviewLevel = 'normal' | 'voucher_review' | 'blocked';

type InvoiceReviewMeta = {
  level: InvoiceReviewLevel;
  label: string;
  color: string;
  description: string;
  selectionCount: number;
  blockedCount: number;
  invoiceCount: number;
};

const statusColorMap: Record<string, string> = {
  [ReimbursementStatus.DRAFT]: 'default',
  [ReimbursementStatus.SUBMITTED]: 'warning',
  [ReimbursementStatus.APPROVED]: 'success',
  [ReimbursementStatus.REJECTED]: 'error',
  [ReimbursementStatus.COMPLETED]: 'processing',
};

const formatCurrency = (value?: number | null) => `¥${Number(value || 0).toFixed(2)}`;

const isHighRisk = (risk?: string | null) => {
  if (!risk) return false;
  const text = String(risk).toLowerCase();
  return text.includes('高') || text.includes('high') || text.includes('严重');
};

const getInvoiceReviewMeta = (reimb: Reimbursement): InvoiceReviewMeta => {
  const invoices = reimb.invoices || [];
  const blockedInvoices = invoices.filter(
    (invoice) =>
      invoice.status === InvoiceStatus.PENDING_RECHECK || invoice.confirmation_mode === 'USER_EDIT',
  );
  const selectionInvoices = invoices.filter(
    (invoice) =>
      invoice.status === InvoiceStatus.PENDING_VOUCHER_REVIEW ||
      invoice.confirmation_mode === 'USER_SELECTION',
  );

  if (blockedInvoices.length > 0) {
    return {
      level: 'blocked',
      label: '阻断异常',
      color: 'error',
      description: `含 ${blockedInvoices.length} 张待重审发票`,
      selectionCount: selectionInvoices.length,
      blockedCount: blockedInvoices.length,
      invoiceCount: invoices.length,
    };
  }

  if (selectionInvoices.length > 0) {
    return {
      level: 'voucher_review',
      label: '待随单审核',
      color: 'gold',
      description: `${selectionInvoices.length} 张发票含人工确认`,
      selectionCount: selectionInvoices.length,
      blockedCount: 0,
      invoiceCount: invoices.length,
    };
  }

  return {
    level: 'normal',
    label: '正常',
    color: 'success',
    description: invoices.length > 0 ? '关联发票均为自动确认' : '暂无关联发票',
    selectionCount: 0,
    blockedCount: 0,
    invoiceCount: invoices.length,
  };
};

const ReimbursementListPage: React.FC = () => {
  const navigate = useNavigate();
  const [data, setData] = useState<Reimbursement[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);

  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [invoiceReviewFilter, setInvoiceReviewFilter] = useState<string>('ALL');
  const [aiRiskFilter, setAiRiskFilter] = useState<string>('ALL');

  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [batchLoading, setBatchLoading] = useState(false);

  const [aiCheckVisible, setAiCheckVisible] = useState(false);
  const [aiCheckReimbId, setAiCheckReimbId] = useState<number | null>(null);
  const [aiCheckResult, setAiCheckResult] = useState<any>(null);
  const [aiCheckLoading, setAiCheckLoading] = useState(false);
  const [approveComment, setApproveComment] = useState('');
  const aiResultCache = useRef<Record<number, any>>({});

  useEffect(() => {
    const userStr = localStorage.getItem('currentUser');
    if (userStr) {
      setCurrentUser(JSON.parse(userStr));
    }
  }, []);

  const fetchData = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await getReimbursements();
      setData(res);
      if (!silent) setSelectedRowKeys([]);
    } catch {
      if (!silent) message.error('获取报销单列表失败');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const timer = setInterval(() => fetchData(true), 10000);
    return () => clearInterval(timer);
  }, []);

  const filteredData = useMemo(() => {
    return data.filter((record) => {
      const reviewMeta = getInvoiceReviewMeta(record);
      const keywordMatched =
        !keyword.trim() ||
        [record.id, record.title, record.submitter, record.project_code]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(keyword.trim().toLowerCase()));

      const statusMatched = statusFilter === 'ALL' || record.status === statusFilter;

      const reviewMatched =
        invoiceReviewFilter === 'ALL' ||
        (invoiceReviewFilter === 'NORMAL' && reviewMeta.level === 'normal') ||
        (invoiceReviewFilter === 'VOUCHER' && reviewMeta.level === 'voucher_review') ||
        (invoiceReviewFilter === 'BLOCKED' && reviewMeta.level === 'blocked');

      const aiMatched =
        aiRiskFilter === 'ALL' ||
        (aiRiskFilter === 'HIGH' && isHighRisk(record.ai_risk_level)) ||
        (aiRiskFilter === 'LOW' && !isHighRisk(record.ai_risk_level));

      return keywordMatched && statusMatched && reviewMatched && aiMatched;
    });
  }, [aiRiskFilter, data, invoiceReviewFilter, keyword, statusFilter]);

  const dashboardStats = useMemo(() => {
    const pending = data.filter((item) => item.status === ReimbursementStatus.SUBMITTED);
    const voucherReview = data.filter((item) => getInvoiceReviewMeta(item).level === 'voucher_review');
    const blocked = data.filter((item) => getInvoiceReviewMeta(item).level === 'blocked');
    const highRisk = data.filter((item) => isHighRisk(item.ai_risk_level));

    return {
      pendingCount: pending.length,
      voucherReviewCount: voucherReview.length,
      blockedCount: blocked.length,
      highRiskCount: highRisk.length,
      pendingAmount: pending.reduce((sum, item) => sum + Number(item.total_amount || 0), 0),
    };
  }, [data]);

  const handleDelete = async (id: number) => {
    try {
      await deleteReimbursement(id);
      message.success('报销单已撤销，关联发票已释放');
      fetchData();
    } catch {
      message.error('撤销失败，请重试');
    }
  };

  const handleOpenAiCheck = (id: number) => {
    setApproveComment('');
    if (id !== aiCheckReimbId) {
      const cached = aiResultCache.current[id];
      if (cached) {
        setAiCheckResult(cached);
      } else {
        const record = data.find((item) => item.id === id);
        setAiCheckResult(record?.ai_review_detail ?? null);
      }
      setAiCheckReimbId(id);
    }
    setAiCheckVisible(true);
  };

  const handleRunAiCheck = async () => {
    if (!aiCheckReimbId) return;
    setAiCheckLoading(true);
    try {
      const res = await aiCheckReimbursement(aiCheckReimbId);
      setAiCheckResult(res);
      aiResultCache.current[aiCheckReimbId] = res;
      setData((prev) =>
        prev.map((item) =>
          item.id === aiCheckReimbId
            ? { ...item, ai_risk_level: res.risk_level, ai_reason: res.reason, ai_review_detail: res }
            : item,
        ),
      );
      message.success('AI 审查完成');
    } catch (e: any) {
      message.error(`AI 审查失败：${e.response?.data?.detail || e.message}`);
    } finally {
      setAiCheckLoading(false);
    }
  };

  const handleBatchAiCheck = () => {
    Modal.confirm({
      title: '批量 AI 合规扫描',
      content: `即将对选中的 ${selectedRowKeys.length} 笔报销单执行 AI 审查。`,
      okText: '开始扫描',
      cancelText: '取消',
      onOk: async () => {
        setBatchLoading(true);
        try {
          const ids = selectedRowKeys as number[];
          const results = await Promise.all(ids.map((id) => aiCheckReimbursement(id)));
          results.forEach((res, index) => {
            aiResultCache.current[ids[index]] = res;
          });
          message.success(`批量扫描完成，共处理 ${results.length} 笔报销单`);
          setSelectedRowKeys([]);
          fetchData();
        } catch {
          message.error('批量审查过程中发生异常');
        } finally {
          setBatchLoading(false);
        }
      },
    });
  };

  const handleBatchApprove = () => {
    const selected = data.filter((item) => selectedRowKeys.includes(item.id));
    const reviewRiskItems = selected.filter((item) => getInvoiceReviewMeta(item).level !== 'normal');
    const highRiskItems = selected.filter((item) => isHighRisk(item.ai_risk_level));

    Modal.confirm({
      title: '批量审批通过',
      content: (
        <div>
          <p>确定要通过选中的 {selectedRowKeys.length} 笔报销单吗？</p>
          {reviewRiskItems.length > 0 && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message={`其中 ${reviewRiskItems.length} 笔含随单复核风险`}
            />
          )}
          {highRiskItems.length > 0 && (
            <Alert
              type="error"
              showIcon
              message={`其中 ${highRiskItems.length} 笔为 AI 高风险`}
            />
          )}
        </div>
      ),
      okText: '确认通过',
      cancelText: '取消',
      okButtonProps: { style: { background: '#1677ff', borderColor: '#1677ff' } },
      onOk: async () => {
        setBatchLoading(true);
        try {
          await Promise.all(
            selectedRowKeys.map((id) => approveReimbursement(id as number, '财务批量审批通过')),
          );
          message.success(`已通过 ${selectedRowKeys.length} 笔报销单`);
          setSelectedRowKeys([]);
          fetchData();
        } catch {
          message.error('批量审批失败');
        } finally {
          setBatchLoading(false);
        }
      },
    });
  };

  const handleBatchReject = () => {
    Modal.confirm({
      title: '批量驳回',
      content: `确定要驳回选中的 ${selectedRowKeys.length} 笔报销单吗？`,
      okText: '确认驳回',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        setBatchLoading(true);
        try {
          await Promise.all(
            selectedRowKeys.map((id) => rejectReimbursement(id as number, '财务批量驳回')),
          );
          message.warning(`已驳回 ${selectedRowKeys.length} 笔报销单`);
          setSelectedRowKeys([]);
          fetchData();
        } catch {
          message.error('批量驳回失败');
        } finally {
          setBatchLoading(false);
        }
      },
    });
  };

  const renderInvoiceReviewTag = (record: Reimbursement) => {
    const review = getInvoiceReviewMeta(record);
    return (
      <Space direction="vertical" size={2}>
        <Tag color={review.color}>{review.label}</Tag>
        <span style={{ fontSize: 12, color: '#8c8c8c' }}>{review.description}</span>
      </Space>
    );
  };

  const columns: ColumnsType<Reimbursement> = [
    { title: '单号', dataIndex: 'id', key: 'id', width: 84 },
    { title: '报销事由', dataIndex: 'title', key: 'title', ellipsis: true },
    {
      title: '提交人',
      dataIndex: 'submitter',
      key: 'submitter',
      width: 110,
      render: (value) => value || currentUser?.full_name || '-',
    },
    {
      title: '金额',
      dataIndex: 'total_amount',
      key: 'total_amount',
      width: 120,
      render: (value) => <span style={{ fontWeight: 600 }}>{formatCurrency(value)}</span>,
    },
    {
      title: '关联发票',
      key: 'invoice_count',
      width: 120,
      render: (_, record) => {
        const meta = getInvoiceReviewMeta(record);
        return (
          <Space>
            <span>{meta.invoiceCount} 张</span>
            {meta.selectionCount > 0 && <Tag color="gold">人工确认</Tag>}
          </Space>
        );
      },
    },
    {
      title: '发票复核',
      key: 'invoice_review',
      width: 180,
      render: (_, record) => renderInvoiceReviewTag(record),
    },
    {
      title: 'AI 风险',
      dataIndex: 'ai_risk_level',
      key: 'ai_risk_level',
      width: 120,
      render: (value) => {
        if (!value) return <span style={{ color: '#bfbfbf' }}>未审查</span>;
        return <Tag color={isHighRisk(value) ? 'error' : 'success'}>{value}</Tag>;
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (status: ReimbursementStatus) => <Tag color={statusColorMap[status] || 'default'}>{status}</Tag>,
    },
    {
      title: '提交时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      render: (value) => new Date(value).toLocaleString(),
    },
    {
      title: '操作',
      key: 'action',
      width: 260,
      render: (_, record) => {
        const isOwner = record.submitter === currentUser?.username || !record.submitter;
        const isAdmin = currentUser?.role === 'admin';
        const review = getInvoiceReviewMeta(record);
        const actionText =
          review.level === 'voucher_review'
            ? '去复核'
            : review.level === 'blocked'
              ? '查看异常'
              : '查看';

        return (
          <Space size="small" wrap>
            <Button
              type="link"
              size="small"
              icon={review.level === 'normal' ? <EyeOutlined /> : <WarningOutlined />}
              onClick={() => navigate(`/reimbursements/${record.id}`)}
            >
              {actionText}
            </Button>

            {(isAdmin || (isOwner && record.status === ReimbursementStatus.SUBMITTED)) && (
              <Popconfirm
                title="确定要撤销这张报销单吗？"
                description="撤销后，关联发票将恢复为可用状态。"
                onConfirm={() => handleDelete(record.id)}
                okText="确认撤销"
                cancelText="取消"
                okButtonProps={{ danger: true }}
              >
                <Button type="link" danger size="small">
                  撤销/删除
                </Button>
              </Popconfirm>
            )}

            {record.status === ReimbursementStatus.SUBMITTED && (
              <>
                {isAdmin ? (
                  <Button
                    type="link"
                    size="small"
                    icon={<RobotOutlined />}
                    style={{ color: record.ai_risk_level ? '#22c55e' : '#1677ff' }}
                    onClick={() => handleOpenAiCheck(record.id)}
                  >
                    {record.ai_risk_level ? '查看 AI 报告' : 'AI 审查'}
                  </Button>
                ) : (
                  <Button type="link" size="small" disabled icon={<ClockCircleOutlined />}>
                    审批中
                  </Button>
                )}
              </>
            )}

            {isAdmin && record.status === ReimbursementStatus.APPROVED && (
              <Popconfirm
                title="确认线下打款"
                description="确认后将模拟打款并生成银行回执。"
                onConfirm={async () => {
                  try {
                    await completeReimbursement(record.id);
                    message.success('打款成功');
                    fetchData();
                  } catch {
                    message.error('打款失败');
                  }
                }}
                okText="确认打款"
                cancelText="取消"
              >
                <Button
                  type="primary"
                  size="small"
                  icon={<DollarOutlined />}
                  style={{ background: '#1677ff', borderColor: '#1677ff', fontWeight: 600 }}
                >
                  确认线下打款
                </Button>
              </Popconfirm>
            )}
          </Space>
        );
      },
    },
  ];

  const ExpandedTimelineRow: React.FC<{ record: Reimbursement }> = ({ record }) => {
    const [timeline, setTimeline] = useState<any[]>([]);
    const [timelineLoading, setTimelineLoading] = useState(false);
    const review = getInvoiceReviewMeta(record);

    useEffect(() => {
      let cancelled = false;
      const fetchTimeline = async () => {
        setTimelineLoading(true);
        try {
          const res = await getReimbursementTimeline(record.id);
          if (!cancelled) setTimeline(res.timeline);
        } catch {
          if (!cancelled) setTimeline([]);
        } finally {
          if (!cancelled) setTimelineLoading(false);
        }
      };
      fetchTimeline();
      return () => {
        cancelled = true;
      };
    }, [record.id]);

    if (timelineLoading) {
      return <div style={{ padding: 16, color: '#999' }}>加载资金追踪...</div>;
    }

    return (
      <div style={{ padding: '12px 16px', background: '#fafafa', borderRadius: 8 }}>
        <Space wrap style={{ marginBottom: 12 }}>
          <Tag color={review.color}>{review.label}</Tag>
          {record.ai_risk_level && <Tag color={isHighRisk(record.ai_risk_level) ? 'error' : 'success'}>{record.ai_risk_level}</Tag>}
          <span style={{ color: '#8c8c8c', fontSize: 12 }}>{review.description}</span>
        </Space>
        {timeline.length === 0 ? (
          <span style={{ color: '#999' }}>暂无追踪记录</span>
        ) : (
          <Timeline>
            {timeline.map((node, index) => (
              <Timeline.Item
                key={index}
                color={
                  node.status === 'done'
                    ? '#22c55e'
                    : node.status === 'processing'
                      ? '#1677ff'
                      : node.status === 'error'
                        ? '#ff4d4f'
                        : '#d9d9d9'
                }
              >
                <div style={{ fontWeight: 600, fontSize: 13 }}>{node.title}</div>
                <div style={{ color: '#666', fontSize: 12, marginTop: 2 }}>
                  {node.time ? new Date(node.time).toLocaleString() : ''}
                </div>
                <div style={{ color: '#444', fontSize: 13, marginTop: 4 }}>{node.description}</div>
              </Timeline.Item>
            ))}
          </Timeline>
        )}
      </div>
    );
  };

  const rowSelection =
    currentUser?.role === 'admin'
      ? {
          selectedRowKeys,
          onChange: (newSelectedRowKeys: React.Key[]) => {
            setSelectedRowKeys(newSelectedRowKeys);
          },
          getCheckboxProps: (record: Reimbursement) => ({
            disabled: record.status !== ReimbursementStatus.SUBMITTED,
            name: record.title,
          }),
        }
      : undefined;

  return (
    <>
      <Card
        title="报销审批台账"
        style={{ margin: '24px' }}
        extra={
          <Button
            icon={<DownloadOutlined />}
            onClick={async () => {
              try {
                const token = localStorage.getItem('sessionToken');
                const res = await fetch('/api/reimbursements/export/excel', {
                  headers: { 'X-Session-Token': token || '' },
                });
                if (!res.ok) throw new Error();
                const blob = await res.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = '报销单台账.xlsx';
                a.click();
                window.URL.revokeObjectURL(url);
              } catch {
                message.error('导出失败');
              }
            }}
          >
            导出 Excel
          </Button>
        }
      >
        <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
          <Col xs={24} md={12} xl={6}>
            <Card size="small">
              <div style={{ color: '#8c8c8c', marginBottom: 8 }}>待审批报销单</div>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{dashboardStats.pendingCount}</div>
            </Card>
          </Col>
          <Col xs={24} md={12} xl={6}>
            <Card size="small">
              <div style={{ color: '#8c8c8c', marginBottom: 8 }}>含随单复核发票</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#d48806' }}>{dashboardStats.voucherReviewCount}</div>
            </Card>
          </Col>
          <Col xs={24} md={12} xl={6}>
            <Card size="small">
              <div style={{ color: '#8c8c8c', marginBottom: 8 }}>阻断异常单据</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#cf1322' }}>{dashboardStats.blockedCount}</div>
            </Card>
          </Col>
          <Col xs={24} md={12} xl={6}>
            <Card size="small">
              <div style={{ color: '#8c8c8c', marginBottom: 8 }}>待处理金额</div>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{formatCurrency(dashboardStats.pendingAmount)}</div>
            </Card>
          </Col>
        </Row>

        <Card size="small" style={{ marginBottom: 16, background: '#fafafa' }}>
          <Row gutter={[12, 12]} align="middle">
            <Col xs={24} md={10} xl={8}>
              <Input
                allowClear
                prefix={<SearchOutlined />}
                placeholder="搜索单号、报销事由、提交人、项目编号"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
            </Col>
            <Col xs={24} sm={12} md={7} xl={5}>
              <Select
                value={statusFilter}
                onChange={setStatusFilter}
                style={{ width: '100%' }}
                options={[
                  { value: 'ALL', label: '全部状态' },
                  { value: ReimbursementStatus.SUBMITTED, label: '待审批' },
                  { value: ReimbursementStatus.APPROVED, label: '已通过' },
                  { value: ReimbursementStatus.COMPLETED, label: '已打款' },
                  { value: ReimbursementStatus.REJECTED, label: '已驳回' },
                ]}
              />
            </Col>
            <Col xs={24} sm={12} md={7} xl={5}>
              <Select
                value={invoiceReviewFilter}
                onChange={setInvoiceReviewFilter}
                style={{ width: '100%' }}
                options={[
                  { value: 'ALL', label: '全部发票复核' },
                  { value: 'NORMAL', label: '正常' },
                  { value: 'VOUCHER', label: '待随单审核' },
                  { value: 'BLOCKED', label: '阻断异常' },
                ]}
              />
            </Col>
            <Col xs={24} sm={12} md={7} xl={4}>
              <Select
                value={aiRiskFilter}
                onChange={setAiRiskFilter}
                style={{ width: '100%' }}
                options={[
                  { value: 'ALL', label: '全部 AI 风险' },
                  { value: 'HIGH', label: '高风险' },
                  { value: 'LOW', label: '低/未审查' },
                ]}
              />
            </Col>
            <Col xs={24} sm={12} md={3} xl={2}>
              <Space style={{ color: '#8c8c8c' }}>
                <FilterOutlined />
                <span>{filteredData.length} 笔</span>
              </Space>
            </Col>
          </Row>
        </Card>

        {selectedRowKeys.length > 0 && (
          <div
            style={{
              marginBottom: 16,
              padding: '14px 20px',
              background: '#fff7e6',
              border: '1px solid #ffd591',
              borderRadius: 10,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <div>
              <span style={{ fontSize: 15, fontWeight: 600 }}>
                已选中 {selectedRowKeys.length} 笔待审批报销单
              </span>
              <div style={{ color: '#8c8c8c', fontSize: 12, marginTop: 4 }}>
                建议先批量 AI 审查，再执行批量审批
              </div>
            </div>
            <Space wrap>
              <Button loading={batchLoading} icon={<RobotOutlined />} onClick={handleBatchAiCheck}>
                AI 批量审查
              </Button>
              <Button
                type="primary"
                loading={batchLoading}
                icon={<ThunderboltOutlined />}
                onClick={handleBatchApprove}
                style={{ background: '#1677ff', borderColor: '#1677ff' }}
              >
                批量通过
              </Button>
              <Button danger loading={batchLoading} icon={<CloseCircleOutlined />} onClick={handleBatchReject}>
                批量驳回
              </Button>
            </Space>
          </div>
        )}

        {dashboardStats.blockedCount > 0 && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
            message={`当前台账中发现 ${dashboardStats.blockedCount} 笔阻断异常单据`}
            description="这类单据理论上不应进入正常审批流，建议优先进入详情页核查关联发票状态。"
          />
        )}

        <Table
          rowSelection={rowSelection}
          columns={columns}
          dataSource={filteredData}
          rowKey="id"
          loading={loading}
          expandable={{ expandedRowRender: (record) => <ExpandedTimelineRow record={record} /> }}
          pagination={{ pageSize: 10, showSizeChanger: false }}
        />
      </Card>

      <Drawer
        title={
          <Space>
            <RobotOutlined />
            <span>AI 智能合规审查</span>
          </Space>
        }
        placement="right"
        width={520}
        open={aiCheckVisible}
        onClose={() => setAiCheckVisible(false)}
      >
        {!aiCheckResult ? (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <p style={{ color: '#7a7a7a', marginBottom: 24 }}>点击下方按钮，AI 将对当前报销单执行合规审查。</p>
            <Button
              type="primary"
              size="large"
              icon={<RobotOutlined />}
              loading={aiCheckLoading}
              onClick={handleRunAiCheck}
              style={{ background: '#1677ff', borderColor: '#1677ff' }}
            >
              启动 AI 审查
            </Button>
          </div>
        ) : (
          <>
            <Card
              style={{
                marginBottom: 16,
                borderLeft: `4px solid ${aiCheckResult.compliance_status === '合规' ? '#22c55e' : '#ef4444'}`,
              }}
            >
              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                <div>
                  <Tag color={aiCheckResult.compliance_status === '合规' ? 'success' : 'error'}>
                    {aiCheckResult.compliance_status}
                  </Tag>
                  <Tag color={isHighRisk(aiCheckResult.risk_level) ? 'error' : 'success'}>
                    风险等级：{aiCheckResult.risk_level}
                  </Tag>
                </div>
                <Alert
                  type={aiCheckResult.compliance_status === '合规' ? 'success' : 'error'}
                  message={aiCheckResult.reason}
                  description={aiCheckResult.remarks}
                  showIcon
                />
              </Space>
            </Card>

            {aiCheckResult.details?.length > 0 && (
              <Card title="审查明细" size="small" style={{ marginBottom: 16 }}>
                {aiCheckResult.details.map((detail: any, index: number) => (
                  <Alert
                    key={index}
                    type={detail.severity === '严重' ? 'error' : detail.severity === '中等' ? 'warning' : 'info'}
                    message={`[${detail.severity}] ${detail.issue}`}
                    description={detail.comment}
                    showIcon
                    style={{ marginBottom: 8 }}
                  />
                ))}
              </Card>
            )}

            <Divider />
            <Input.TextArea
              rows={3}
              placeholder="请输入审批意见"
              value={approveComment}
              onChange={(e) => setApproveComment(e.target.value)}
              style={{ marginBottom: 12 }}
            />
            <Space>
              <Button
                type="primary"
                icon={<CheckCircleOutlined />}
                style={{ background: '#22c55e', borderColor: '#22c55e' }}
                onClick={() => {
                  Modal.confirm({
                    title: '确认审批通过',
                    content: '确定要通过当前报销单吗？',
                    okText: '确认通过',
                    cancelText: '取消',
                    okButtonProps: { style: { background: '#22c55e', borderColor: '#22c55e' } },
                    onOk: async () => {
                      try {
                        await approveReimbursement(aiCheckReimbId!, approveComment);
                        message.success('已审批通过');
                        setAiCheckVisible(false);
                        fetchData();
                      } catch (e: any) {
                        message.error(`操作失败：${e.response?.data?.detail || e.message}`);
                      }
                    },
                  });
                }}
              >
                审批通过
              </Button>
              <Button
                danger
                icon={<CloseCircleOutlined />}
                onClick={async () => {
                  if (!approveComment.trim()) {
                    message.warning('驳回请填写原因');
                    return;
                  }
                  try {
                    await rejectReimbursement(aiCheckReimbId!, approveComment);
                    message.success('已驳回');
                    setAiCheckVisible(false);
                    fetchData();
                  } catch (e: any) {
                    message.error(`操作失败：${e.response?.data?.detail || e.message}`);
                  }
                }}
              >
                驳回
              </Button>
            </Space>
          </>
        )}
      </Drawer>
    </>
  );
};

export default ReimbursementListPage;
