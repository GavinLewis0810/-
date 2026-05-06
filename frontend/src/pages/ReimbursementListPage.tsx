import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Table, Tag, Button, Space, message, Card, Popconfirm, Drawer,
  Alert, Divider, Input, Modal, Timeline
} from 'antd';
import {
  RobotOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  EyeOutlined,
  ThunderboltOutlined,
  ClockCircleOutlined,
  DownloadOutlined,
  DollarOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  getReimbursements,
  deleteReimbursement,
  aiCheckReimbursement,
  approveReimbursement,
  rejectReimbursement,
  completeReimbursement,
  getReimbursementTimeline,
} from '../services/api';
import { Reimbursement, ReimbursementStatus } from '../types/invoice';

const ReimbursementListPage: React.FC = () => {
  const navigate = useNavigate();
  const [data, setData] = useState<Reimbursement[]>([]);
  const [loading, setLoading] = useState(false);

  // AI 审查相关状态
  const [aiCheckVisible, setAiCheckVisible] = useState(false);
  const [aiCheckReimbId, setAiCheckReimbId] = useState<number | null>(null);
  const [aiCheckResult, setAiCheckResult] = useState<any>(null);
  const [aiCheckLoading, setAiCheckLoading] = useState(false);
  const [approveComment, setApproveComment] = useState('');
  // 🚀 useRef 缓存：React 状态可能被覆盖，但 ref 永不失忆
  const aiResultCache = useRef<Record<number, any>>({});

  // 当前登录用户信息
  const [currentUser, setCurrentUser] = useState<any>(null);

  // 批处理引擎相关状态
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [batchLoading, setBatchLoading] = useState(false);

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
    } catch (error) {
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

  const handleDelete = async (id: number) => {
    try {
      await deleteReimbursement(id);
      message.success('报销单已撤销，发票已释放！');
      fetchData();
    } catch (error) {
      message.error('删除失败，请重试');
    }
  };

  // 打开 AI 审查抽屉（useRef 缓存 + data 兜底，绝不丢数据）
  const handleOpenAiCheck = (id: number) => {
    setApproveComment('');
    if (id !== aiCheckReimbId) {
      // 优先从 ref 缓存取（刚审查完的结果），其次从 data 取（历史持久化结果）
      const cached = aiResultCache.current[id];
      if (cached) {
        setAiCheckResult(cached);
      } else {
        const record = data.find(item => item.id === id);
        setAiCheckResult(record?.ai_review_detail ?? null);
      }
      setAiCheckReimbId(id);
    }
    setAiCheckVisible(true);
  };

  // 执行单次 AI 审查
  const handleRunAiCheck = async () => {
    if (!aiCheckReimbId) return;
    setAiCheckLoading(true);
    try {
      const res = await aiCheckReimbursement(aiCheckReimbId);
      setAiCheckResult(res);
      // 三重保险：state + data + ref，关闭重开绝不丢失
      aiResultCache.current[aiCheckReimbId] = res;
      setData(prev => prev.map(item =>
        item.id === aiCheckReimbId
          ? { ...item, ai_risk_level: res.risk_level, ai_reason: res.reason, ai_review_detail: res }
          : item
      ));
      message.success('AI 审查完成');
    } catch (e: any) {
      message.error('AI 审查失败：' + (e.response?.data?.detail || e.message));
    } finally {
      setAiCheckLoading(false);
    }
  };

  // 🚀 批量并发 AI 审查引擎 (带统计汇总 + 确认弹窗)
  const handleBatchAiCheck = () => {
    Modal.confirm({
      title: '批量 AI 探针扫描',
      content: `即将对选中的 ${selectedRowKeys.length} 笔报销单并发执行 AI 合规审查。审查完成后可在每笔单据的「AI 智能审批」中查看完整报告。`,
      okText: '启动并发扫描',
      cancelText: '取消',
      onOk: async () => {
        setBatchLoading(true);
        try {
          const ids = selectedRowKeys as number[];
          const results = await Promise.all(
            ids.map(id => aiCheckReimbursement(id))
          );
          // 批量结果也同步写入 ref 缓存，点「AI 智能审批」即可看完整明细
          results.forEach((res, i) => {
            aiResultCache.current[ids[i]] = res;
          });

          let highRiskCount = 0;
          let lowRiskCount = 0;
          results.forEach(res => {
            if (res.risk_level?.includes('高') || res.risk_level?.includes('危')) {
              highRiskCount++;
            } else {
              lowRiskCount++;
            }
          });

          message.success(
            `并发扫描完成！排查 ${results.length} 单：${highRiskCount} 笔高风险，${lowRiskCount} 笔低风险。点击各单据「AI 智能审批」查看完整明细报告。`,
            6
          );
          setSelectedRowKeys([]);
          fetchData();
        } catch (e: any) {
          message.error('批量审查过程中出现异常，请检查网络');
        } finally {
          setBatchLoading(false);
        }
      },
    });
  };

  // 🚀 批量审批通过引擎（带确认弹窗）
  const handleBatchApprove = () => {
    // 检查高危项
    const selected = data.filter(item => selectedRowKeys.includes(item.id));
    const highRiskItems = selected.filter(item => {
      const risk = String(item.ai_risk_level || '');
      return risk.includes('高') || risk.includes('危');
    });

    const content = (
      <div>
        <p>确定要一次性通过选中的 <strong>{selectedRowKeys.length}</strong> 笔报销单吗？</p>
        {highRiskItems.length > 0 && (
          <Alert type="error" showIcon style={{ marginTop: 12 }}
            message={`⚠️ 其中 ${highRiskItems.length} 笔为 AI 判定高风险！`}
            description={highRiskItems.map(r => `#${r.id} ${r.title} — ${r.ai_risk_level}`).join('，')} />
        )}
      </div>
    );

    Modal.confirm({
      title: highRiskItems.length > 0 ? '⚠️ 批量审批通过（含高危项）' : '批量审批通过',
      content,
      okText: '一键审批通过',
      cancelText: '取消',
      okButtonProps: { style: { background: '#E42313', borderColor: '#E42313' } },
      onOk: async () => {
        setBatchLoading(true);
        try {
          await Promise.all(
            selectedRowKeys.map(id => approveReimbursement(id as number, "财务批量审批通过"))
          );
          message.success(`打款流水线执行成功！已通过 ${selectedRowKeys.length} 笔报销。`);
          setSelectedRowKeys([]);
          fetchData();
        } catch (e: any) {
          message.error('批量审批失败');
        } finally {
          setBatchLoading(false);
        }
      },
    });
  };

  // 🚀 批量驳回引擎
  const handleBatchReject = () => {
    Modal.confirm({
      title: '批量驳回',
      content: `确定要驳回选中的 ${selectedRowKeys.length} 笔报销单吗？关联发票将被释放回「已确认」状态。`,
      okText: '一键驳回全部',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        setBatchLoading(true);
        try {
          await Promise.all(
            selectedRowKeys.map(id => rejectReimbursement(id as number, "财务批量驳回"))
          );
          message.warning(`已驳回 ${selectedRowKeys.length} 笔报销单，关联发票已释放。`);
          setSelectedRowKeys([]);
          fetchData();
        } catch (e: any) {
          message.error('批量驳回失败');
        } finally {
          setBatchLoading(false);
        }
      },
    });
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
    {
      title: '提交人',
      dataIndex: 'submitter',
      key: 'submitter',
      render: (val) => val || currentUser?.full_name || '未知'
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: ReimbursementStatus) => getStatusTag(status),
    },
    {
      title: 'AI风控建议',
      dataIndex: 'ai_risk_level',
      key: 'ai_risk_level',
      render: (val) => {
        if (!val) return <span style={{color: '#aaa'}}>-</span>;
        return <Tag color={val.includes('高') || val.includes('危') ? 'error' : 'success'}>{val}</Tag>;
      }
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
      render: (_, record) => {
        const isOwner = record.submitter === currentUser?.username || !record.submitter;
        const isAdmin = currentUser?.role === 'admin';

        return (
          <Space size="middle">
            <Button type="link" size="small" icon={<EyeOutlined />}
              onClick={() => navigate(`/reimbursements/${record.id}`)}>
              详情
            </Button>
            {(isAdmin || (isOwner && record.status === ReimbursementStatus.SUBMITTED)) && (
              <Popconfirm
                title="确定要撤销这个报销单吗？"
                description="撤销后，包含在内的发票将恢复为可用状态。"
                onConfirm={() => handleDelete(record.id)}
                okText="确定撤销"
                cancelText="取消"
                okButtonProps={{ danger: true }}
              >
                <Button type="link" danger size="small">撤销/删除</Button>
              </Popconfirm>
            )}

            {record.status === ReimbursementStatus.SUBMITTED && (
              <>
                {isAdmin ? (
                  record.ai_risk_level ? (
                    <Button
                      type="link"
                      size="small"
                      icon={<RobotOutlined />}
                      style={{ color: '#22C55E' }}
                      onClick={() => {
                        setAiCheckReimbId(record.id);
                        if (record.ai_review_detail && record.ai_review_detail.compliance_status) {
                            setAiCheckResult(record.ai_review_detail);
                        } else {
                            setAiCheckResult({
                                compliance_status: record.ai_risk_level?.includes('高') ? '不合规' : '合规',
                                risk_level: record.ai_risk_level || '未知',
                                reason: record.ai_reason || '暂无结论',
                                details: []
                            });
                        }
                        setApproveComment('');
                        setAiCheckVisible(true);
                      }}
                    >
                      查看 AI 报告
                    </Button>
                  ) : (
                    <Button
                      type="link"
                      size="small"
                      icon={<RobotOutlined />}
                      style={{ color: '#E42313' }}
                      onClick={() => handleOpenAiCheck(record.id)}
                    >
                      AI 智能审批
                    </Button>
                  )
                ) : (
                  <Button type="link" size="small" disabled icon={<EyeOutlined />}>审批中...</Button>
                )}
              </>
            )}

            {isAdmin && record.status === ReimbursementStatus.APPROVED && (
              <Popconfirm
                title="确认线下打款"
                description="系统将模拟银企直联转账，生成银行电子回单。"
                onConfirm={async () => {
                  try {
                    await completeReimbursement(record.id);
                    message.success('打款成功！银行电子回单已生成');
                    fetchData();
                  } catch { message.error('打款失败'); }
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

  // 资金追踪时间轴展开行组件
  const ExpandedTimelineRow: React.FC<{ record: Reimbursement }> = ({ record }) => {
    const [timeline, setTimeline] = useState<any[]>([]);
    const [timelineLoading, setTimelineLoading] = useState(false);

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
      return () => { cancelled = true; };
    }, [record.id]);

    const statusColorMap: Record<string, string> = {
      done: '#22C55E',
      processing: '#1677ff',
      pending: '#d9d9d9',
      error: '#E42313',
    };

    const statusIconMap: Record<string, React.ReactNode> = {
      done: <CheckCircleOutlined />,
      processing: <ClockCircleOutlined />,
      pending: <ClockCircleOutlined />,
      error: <CloseCircleOutlined />,
    };

    if (timelineLoading) return <div style={{ padding: 16, color: '#999' }}>加载资金追踪...</div>;

    return (
      <div style={{ padding: '12px 16px', background: '#fafafa', borderRadius: 8 }}>
        <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>资金追踪时间轴</span>
          <span style={{ fontSize: 12, color: '#999', fontWeight: 400 }}>— {timeline.length} 个节点</span>
        </div>
        {timeline.length === 0 ? (
          <span style={{ color: '#999' }}>暂无追踪记录</span>
        ) : (
          <Timeline>
            {timeline.map((node, idx) => (
              <Timeline.Item
                key={idx}
                color={statusColorMap[node.status] || '#d9d9d9'}
                dot={statusIconMap[node.status]}
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

  const expandedRowRender = (record: Reimbursement) => <ExpandedTimelineRow record={record} />;

  const rowSelection = currentUser?.role === 'admin' ? {
    selectedRowKeys,
    onChange: (newSelectedRowKeys: React.Key[]) => {
      setSelectedRowKeys(newSelectedRowKeys);
    },
    getCheckboxProps: (record: Reimbursement) => ({
      disabled: record.status !== ReimbursementStatus.SUBMITTED,
      name: record.title,
    }),
  } : undefined;

  return (
    <>
      <Card title="报销单台账" style={{ margin: '24px' }}
        extra={
          <Button icon={<DownloadOutlined />} onClick={async () => {
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
            } catch { message.error('导出失败'); }
          }}>
            导出 Excel
          </Button>
        }>

        {selectedRowKeys.length > 0 && (
          <div style={{
            marginBottom: 16,
            padding: '14px 24px',
            background: 'linear-gradient(135deg, #fff2f0 0%, #fff7f7 100%)',
            border: '2px solid #E42313',
            borderRadius: 10,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            boxShadow: '0 4px 16px rgba(228, 35, 19, 0.15)'
          }}>
            <div>
              <span style={{ fontSize: 15, fontWeight: 600, color: '#333' }}>
                已勾选 <strong style={{ color: '#E42313', fontSize: 20, margin: '0 2px' }}>{selectedRowKeys.length}</strong> 笔待审批单据
              </span>
              <span style={{ color: '#999', marginLeft: 12, fontSize: 13 }}>
                · 并发批处理引擎就绪
              </span>
            </div>
            <Space size="middle">
              <Button
                loading={batchLoading}
                icon={<RobotOutlined />}
                onClick={handleBatchAiCheck}
                style={{ color: '#E42313', borderColor: '#E42313', fontWeight: 500 }}
              >
                AI 批量探针扫描
              </Button>
              <Button
                type="primary"
                loading={batchLoading}
                icon={<ThunderboltOutlined />}
                onClick={handleBatchApprove}
                style={{ background: '#E42313', borderColor: '#E42313', fontWeight: 600 }}
              >
                一键批量通过
              </Button>
              <Button
                danger
                loading={batchLoading}
                icon={<CloseCircleOutlined />}
                onClick={handleBatchReject}
              >
                批量驳回
              </Button>
            </Space>
          </div>
        )}

        <Table
          rowSelection={rowSelection}
          columns={columns}
          dataSource={data}
          rowKey="id"
          loading={loading}
          expandable={{ expandedRowRender }}
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
        onClose={() => {
          setAiCheckVisible(false);
          // 不在此处刷新列表，避免覆盖掉刚缓存到 data 里的 ai_review_detail
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
                  onClick={() => {
                    // 检查风险项
                    const riskWarnings: string[] = [];
                    if (aiCheckResult?.risk_level && (aiCheckResult.risk_level === '高' || aiCheckResult.risk_level === '中')) {
                      riskWarnings.push(`AI 风险评级：${aiCheckResult.risk_level}风险`);
                    }
                    Modal.confirm({
                      title: riskWarnings.length > 0 ? '⚠️ 确认审批通过（含风险预警）' : '确认审批通过',
                      content: riskWarnings.length > 0
                        ? <Alert type="error" showIcon message="以下风险项请仔细确认：" description={riskWarnings.join('\n')} />
                        : '确定要通过该报销单吗？',
                      okText: '确认通过',
                      cancelText: '取消',
                      okButtonProps: { style: { background: '#22C55E', borderColor: '#22C55E' } },
                      onOk: async () => {
                        try {
                          await approveReimbursement(aiCheckReimbId!, approveComment);
                          message.success('已审批通过');
                          setAiCheckVisible(false);
                          fetchData();
                        } catch (e: any) {
                          message.error('操作失败：' + (e.response?.data?.detail || e.message));
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
                      // 🚀 修复 TS 报错：传纯字符串
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