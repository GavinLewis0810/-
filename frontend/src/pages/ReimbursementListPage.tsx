import React, { useState, useEffect } from 'react';
import {
  Table, Tag, Button, Space, message, Card, Popconfirm, Drawer,
  Alert, Divider, Input
} from 'antd';
import {
  RobotOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  getReimbursements,
  deleteReimbursement,
  aiCheckReimbursement,
  approveReimbursement,
  rejectReimbursement,
} from '../services/api';
import { Reimbursement, ReimbursementStatus } from '../types/invoice';

const ReimbursementListPage: React.FC = () => {
  const [data, setData] = useState<Reimbursement[]>([]);
  const [loading, setLoading] = useState(false);

  // AI 审查相关状态
  const [aiCheckVisible, setAiCheckVisible] = useState(false);
  const [aiCheckReimbId, setAiCheckReimbId] = useState<number | null>(null);
  const [aiCheckResult, setAiCheckResult] = useState<any>(null);
  const [aiCheckLoading, setAiCheckLoading] = useState(false);
  const [approveComment, setApproveComment] = useState('');

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await getReimbursements();
      setData(res);
    } catch (error) {
      message.error('获取报销单列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleDelete = async (id: number) => {
    try {
      await deleteReimbursement(id);
      message.success('报销单已撤销，发票已释放！');
      fetchData();
    } catch (error) {
      message.error('删除失败，请重试');
    }
  };

  // 打开 AI 审查抽屉
  const handleOpenAiCheck = (id: number) => {
    setAiCheckReimbId(id);
    setAiCheckResult(null);
    setApproveComment('');
    setAiCheckVisible(true);
  };

  // 执行 AI 审查
  const handleRunAiCheck = async () => {
    if (!aiCheckReimbId) return;
    setAiCheckLoading(true);
    try {
      const res = await aiCheckReimbursement(aiCheckReimbId);
      setAiCheckResult(res);
      message.success('AI 审查完成');
    } catch (e: any) {
      message.error('AI 审查失败：' + (e.response?.data?.detail || e.message));
    } finally {
      setAiCheckLoading(false);
    }
  };

  const getStatusTag = (status: ReimbursementStatus) => {
    const statusMap: Record<string, string> = {
      [ReimbursementStatus.DRAFT]: 'default',
      [ReimbursementStatus.SUBMITTED]: 'warning',
      [ReimbursementStatus.APPROVED]: 'success',
      [ReimbursementStatus.REJECTED]: 'error',
      [ReimbursementStatus.COMPLETED]: 'processing',
    };
    return <Tag color={statusMap[status] || 'default'}>{status}</Tag>;
  };

  const columns: ColumnsType<Reimbursement> = [
    { title: '单号', dataIndex: 'id', key: 'id', width: 80 },
    { title: '报销事由', dataIndex: 'title', key: 'title' },
    { title: '项目编号', dataIndex: 'project_code', key: 'project_code', render: (val) => val || '-' },
    {
      title: '总金额',
      dataIndex: 'total_amount',
      key: 'total_amount',
      render: (val) => `¥${Number(val).toFixed(2)}`,
    },
    { title: '提交人', dataIndex: 'submitter', key: 'submitter', render: (val) => val || '当前用户' },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: ReimbursementStatus) => getStatusTag(status),
    },
    {
      title: '提交时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (val) => new Date(val).toLocaleString(),
    },
    {
      title: '操作',
      key: 'action',
      render: (_, record) => (
        <Space size="middle">
          <Popconfirm
            title="确定要撤销这个报销单吗？"
            description="撤销后，包含在内的发票将恢复为可用状态。"
            onConfirm={() => handleDelete(record.id)}
            okText="确定撤销"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button type="link" danger size="small">删除</Button>
          </Popconfirm>

          {record.status === ReimbursementStatus.SUBMITTED && (
            <>
              <Button
                type="link"
                size="small"
                icon={<RobotOutlined />}
                style={{ color: '#E42313' }}
                onClick={() => handleOpenAiCheck(record.id)}
              >
                AI 审查
              </Button>
              <Button type="link" size="small">审批</Button>
            </>
          )}
        </Space>
      ),
    },
  ];

  // 展开行子表格
  const expandedRowRender = (record: Reimbursement) => {
    const invoiceColumns = [
      { title: '发票号码', dataIndex: 'invoice_number', key: 'invoice_number' },
      { title: '开票日期', dataIndex: 'issue_date', key: 'issue_date' },
      { title: '项目名称', dataIndex: 'item_name', key: 'item_name' },
      {
        title: '金额',
        dataIndex: 'amount',
        key: 'amount',
        render: (val: any) => val ? `¥${Number(val).toFixed(2)}` : '-',
      },
    ];

    return (
      <Table
        columns={invoiceColumns}
        dataSource={record.invoices || []}
        pagination={false}
        size="small"
        rowKey="id"
      />
    );
  };

  return (
    <>
      <Card title="报销单台账" style={{ margin: '24px' }}>
        <Table
          columns={columns}
          dataSource={data}
          rowKey="id"
          loading={loading}
          expandable={{ expandedRowRender }}
        />
      </Card>

      {/* AI 审查抽屉 */}
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
        onClose={() => {
          setAiCheckVisible(false);
          fetchData(); // 关闭时刷新列表，可能状态已更改
        }}
      >
        {!aiCheckResult ? (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <p style={{ color: '#7A7A7A', marginBottom: 24 }}>
              点击下方按钮，AI 将自动审查该报销单
            </p>
            <Button
              type="primary"
              size="large"
              icon={<RobotOutlined />}
              loading={aiCheckLoading}
              onClick={handleRunAiCheck}
              style={{
                background: '#E42313',
                borderColor: '#E42313',
              }}
            >
              启动 AI 审查
            </Button>
          </div>
        ) : (
          <>
            {/* 审查结论卡片 */}
            <Card
              style={{
                marginBottom: 16,
                borderLeft: `4px solid ${
                  aiCheckResult.compliance_status === '合规' ? '#22C55E' : '#EF4444'
                }`,
              }}
            >
              <Space direction="vertical" size="small" style={{ width: '100%' }}>
                <div>
                  <Tag
                    color={aiCheckResult.compliance_status === '合规' ? 'success' : 'error'}
                    style={{ fontSize: 14, padding: '4px 12px' }}
                  >
                    {aiCheckResult.compliance_status}
                  </Tag>
                  <Tag
                    color={
                      aiCheckResult.risk_level === '高'
                        ? 'error'
                        : aiCheckResult.risk_level === '中'
                        ? 'warning'
                        : 'success'
                    }
                    style={{ fontSize: 14, padding: '4px 12px' }}
                  >
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

            {/* 审查明细 */}
            {aiCheckResult.details?.length > 0 && (
              <Card title="审查明细" size="small" style={{ marginBottom: 16 }}>
                {aiCheckResult.details.map((d: any, idx: number) => (
                  <Alert
                    key={idx}
                    type={
                      d.severity === '严重' ? 'error' : d.severity === '中等' ? 'warning' : 'info'
                    }
                    message={`[${d.severity}] ${d.issue}`}
                    description={d.comment}
                    showIcon
                    style={{ marginBottom: 8 }}
                  />
                ))}
              </Card>
            )}

            {/* 审批操作 */}
            <Divider />
            <div style={{ marginTop: 16 }}>
              <Input.TextArea
                rows={3}
                placeholder="请输入审批意见..."
                value={approveComment}
                onChange={(e) => setApproveComment(e.target.value)}
                style={{ marginBottom: 12 }}
              />
              <Space>
                <Button
                  type="primary"
                  icon={<CheckCircleOutlined />}
                  style={{ background: '#22C55E', borderColor: '#22C55E' }}
                  onClick={async () => {
                    try {
                      await approveReimbursement(aiCheckReimbId!, approveComment);
                      message.success('已审批通过');
                      setAiCheckVisible(false);
                      fetchData();
                    } catch (e: any) {
                      message.error('操作失败：' + (e.response?.data?.detail || e.message));
                    }
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
                      message.error('操作失败：' + (e.response?.data?.detail || e.message));
                    }
                  }}
                >
                  驳回
                </Button>
              </Space>
            </div>
          </>
        )}
      </Drawer>
    </>
  );
};

export default ReimbursementListPage;