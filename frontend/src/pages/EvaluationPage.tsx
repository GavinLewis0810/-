import { useEffect, useState } from 'react';
import {
  Alert,
  Card,
  Col,
  Empty,
  Progress,
  Row,
  Spin,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd';
import {
  AuditOutlined,
  CheckCircleOutlined,
  ExperimentOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { getFusionExperiment, getWorkflowMetrics } from '../services/api';
import type { FusionExperimentResponse, WorkflowMetricsResponse } from '../types/invoice';

const { Paragraph, Text } = Typography;

const rateColor = (value: number) => {
  if (value >= 0.9) return '#52c41a';
  if (value >= 0.75) return '#1677ff';
  if (value >= 0.6) return '#faad14';
  return '#ff4d4f';
};

const renderRate = (value: number) => (
  <Progress
    percent={Math.round(value * 100)}
    size="small"
    strokeColor={rateColor(value)}
  />
);

function EvaluationPage() {
  const [experiment, setExperiment] = useState<FusionExperimentResponse | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowMetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [expRes, workflowRes] = await Promise.all([
        getFusionExperiment(),
        getWorkflowMetrics(),
      ]);
      setExperiment(expRes);
      setWorkflow(workflowRes);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 80, textAlign: 'center' }}>
        <Spin size="large" tip="加载融合策略评估数据..." />
      </div>
    );
  }

  if (!experiment || !experiment.annotated_count) {
    return (
      <div style={{ padding: 40, maxWidth: 1200, margin: '0 auto' }}>
        <h2 style={{ marginBottom: 24 }}>
          <ExperimentOutlined style={{ marginRight: 8 }} />
          双引擎融合策略效果验证
        </h2>
        <Empty description="暂无标注数据">
          <p style={{ color: '#999' }}>先在发票详情页标注真值，再回到这里查看离线实验结果。</p>
        </Empty>
      </div>
    );
  }

  const fieldColumns = [
    { title: '字段', dataIndex: 'label', key: 'label', width: 170 },
    { title: 'OCR准确率', dataIndex: 'ocr', key: 'ocr', width: 180, render: renderRate },
    { title: 'LLM准确率', dataIndex: 'llm', key: 'llm', width: 180, render: renderRate },
    { title: '融合准确率', dataIndex: 'fusion', key: 'fusion', width: 180, render: renderRate },
    {
      title: '提升幅度',
      dataIndex: 'gain',
      key: 'gain',
      width: 120,
      render: (value: number) => (
        <Text style={{ color: value >= 0 ? '#1677ff' : '#ff4d4f', fontWeight: 600 }}>
          {(value * 100).toFixed(1)}%
        </Text>
      ),
    },
    { title: '样本数', dataIndex: 'samples', key: 'samples', width: 90 },
  ];

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ marginBottom: 12 }}>
          <ExperimentOutlined style={{ marginRight: 8 }} />
          双引擎融合策略效果验证
        </h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Tag color="blue">{experiment.annotated_count} 张已标注发票</Tag>
          <Tag>{experiment.total_fields} 个字段样本</Tag>
          <Tag color="geekblue">离线算法实验 + 在线人机协同评估</Tag>
        </div>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 24 }}
        message="实验口径"
        description="上半部分使用离线重跑的机器融合策略，只比较 OCR、LLM 和融合算法本身；下半部分展示真实在线流程中的自动放行、冲突分流与人工补救效果。"
      />

      <Card
        title="第一层：离线纯算法实验"
        extra={<Text type="secondary">主结论区：证明融合策略优于单引擎</Text>}
        style={{ marginBottom: 24, borderTop: '3px solid #1677ff' }}
      >
        <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
          <Col xs={24} sm={12} xl={6}>
            <Card>
              <Statistic
                title="OCR整体准确率"
                value={experiment.overall.ocr * 100}
                suffix="%"
                precision={1}
                valueStyle={{ color: rateColor(experiment.overall.ocr) }}
                prefix={<ThunderboltOutlined />}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} xl={6}>
            <Card>
              <Statistic
                title="LLM整体准确率"
                value={experiment.overall.llm * 100}
                suffix="%"
                precision={1}
                valueStyle={{ color: rateColor(experiment.overall.llm) }}
                prefix={<RobotOutlined />}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} xl={6}>
            <Card>
              <Statistic
                title="融合策略整体准确率"
                value={experiment.overall.fusion * 100}
                suffix="%"
                precision={1}
                valueStyle={{ color: rateColor(experiment.overall.fusion) }}
                prefix={<CheckCircleOutlined />}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} xl={6}>
            <Card>
              <Statistic
                title="较最佳单引擎提升"
                value={experiment.overall.fusion_gain * 100}
                suffix="%"
                precision={1}
                valueStyle={{ color: experiment.overall.fusion_gain >= 0 ? '#1677ff' : '#ff4d4f' }}
                prefix={<SafetyCertificateOutlined />}
              />
            </Card>
          </Col>
        </Row>

        <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
          {experiment.strategy_cards.map((item) => (
            <Col xs={24} md={12} xl={6} key={item.key}>
              <Card size="small" style={{ height: '100%', background: '#f8fbff' }}>
                <Text strong>{item.title}</Text>
                <Paragraph style={{ margin: '10px 0 0', color: '#475569' }}>
                  {item.desc}
                </Paragraph>
              </Card>
            </Col>
          ))}
        </Row>

        <Card
          size="small"
          title="字段级实验结果"
          extra={<Text type="secondary">融合准确率仅统计机器自动裁决结果</Text>}
        >
          <Table
            dataSource={experiment.per_field}
            columns={fieldColumns}
            rowKey="field"
            pagination={false}
            scroll={{ x: 900 }}
          />
        </Card>
      </Card>

      <Card
        title="第二层：在线人机协同流程"
        extra={<Text type="secondary">辅助工程区：证明风险分流与落地合理性</Text>}
        style={{ marginBottom: 24, borderTop: '3px solid #13c2c2' }}
      >
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12} xl={6}>
            <Card>
              <Statistic
                title="双引擎冲突率"
                value={(workflow?.conflict_rate || 0) * 100}
                suffix="%"
                precision={1}
                valueStyle={{ color: rateColor(workflow?.conflict_rate || 0) }}
                prefix={<AuditOutlined />}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} xl={6}>
            <Card>
              <Statistic
                title="自动通过率"
                value={(workflow?.auto_pass_rate || 0) * 100}
                suffix="%"
                precision={1}
                valueStyle={{ color: rateColor(workflow?.auto_pass_rate || 0) }}
                prefix={<CheckCircleOutlined />}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} xl={6}>
            <Card>
              <Statistic
                title="自动裁决命中率"
                value={(workflow?.auto_decision_hit_rate || 0) * 100}
                suffix="%"
                precision={1}
                valueStyle={{ color: rateColor(workflow?.auto_decision_hit_rate || 0) }}
                prefix={<RobotOutlined />}
              />
            </Card>
          </Col>
          <Col xs={24} sm={12} xl={6}>
            <Card>
              <Statistic
                title="最终正确率"
                value={(workflow?.final_human_in_loop_accuracy || 0) * 100}
                suffix="%"
                precision={1}
                valueStyle={{ color: rateColor(workflow?.final_human_in_loop_accuracy || 0) }}
                prefix={<SafetyCertificateOutlined />}
              />
            </Card>
          </Col>
        </Row>

        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col xs={24} md={12}>
            <Card size="small" title="流程解读">
              <Paragraph style={{ marginBottom: 8 }}>
                冲突字段会先经过机器裁决；当字段分数差距不足或规则无法给出明确答案时，系统不会盲目选边，而是进入人工复核。
              </Paragraph>
              <Paragraph style={{ marginBottom: 0 }}>
                这样既能在低风险字段上提升自动化率，也能在高风险字段上保留审慎控制，符合报销业务的风控要求。
              </Paragraph>
            </Card>
          </Col>
          <Col xs={24} md={12}>
            <Card size="small" title="当前流程计数">
              <Row gutter={[16, 16]}>
                <Col span={12}>
                  <Statistic title="冲突字段数" value={workflow?.counts.conflict_count || 0} suffix="个" />
                </Col>
                <Col span={12}>
                  <Statistic title="自动通过字段" value={workflow?.counts.auto_pass_count || 0} suffix="个" />
                </Col>
                <Col span={12}>
                  <Statistic title="人工复核字段" value={workflow?.counts.manual_review_count || 0} suffix="个" />
                </Col>
                <Col span={12}>
                  <Statistic title="自动裁决冲突样本" value={workflow?.counts.machine_conflict_decisions || 0} suffix="个" />
                </Col>
              </Row>
            </Card>
          </Col>
        </Row>
      </Card>

      <Card
        title="典型冲突案例"
        extra={<Text type="secondary">答辩时可直接拿来讲“为什么这样选边”</Text>}
        style={{ borderTop: '3px solid #722ed1' }}
      >
        {experiment.typical_cases.length === 0 ? (
          <Empty description="当前还没有可展示的自动裁决冲突案例" />
        ) : (
          <Row gutter={[16, 16]}>
            {experiment.typical_cases.map((item) => (
              <Col xs={24} xl={8} key={`${item.invoice_id}-${item.field}`}>
                <Card size="small" style={{ height: '100%' }}>
                  <div style={{ marginBottom: 10 }}>
                    <Text strong>{item.label}</Text>
                    <Tag color="purple" style={{ marginLeft: 8 }}>{item.fusion_source}</Tag>
                  </div>
                  <Paragraph style={{ marginBottom: 6 }}>
                    <Text type="secondary">OCR：</Text>{item.ocr_value || '-'}
                  </Paragraph>
                  <Paragraph style={{ marginBottom: 6 }}>
                    <Text type="secondary">LLM：</Text>{item.llm_value || '-'}
                  </Paragraph>
                  <Paragraph style={{ marginBottom: 6 }}>
                    <Text type="secondary">融合决策：</Text>{item.fusion_value || '转人工'}
                  </Paragraph>
                  <Paragraph style={{ marginBottom: 6 }}>
                    <Text type="secondary">真值：</Text>{item.ground_truth || '-'}
                  </Paragraph>
                  <Paragraph style={{ marginBottom: 6 }}>
                    <Text type="secondary">规则类型：</Text>{item.decision_rule_type}
                  </Paragraph>
                  <Paragraph style={{ marginBottom: 0 }}>
                    <Text type="secondary">裁决依据：</Text>{item.decision_reason.join('，') || '无'}
                  </Paragraph>
                </Card>
              </Col>
            ))}
          </Row>
        )}
      </Card>
    </div>
  );
}

export default EvaluationPage;
