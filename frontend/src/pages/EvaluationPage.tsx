import { useState, useEffect } from 'react';
import { Card, Table, Spin, Statistic, Row, Col, Progress, Tag, Empty } from 'antd';
import { ExperimentOutlined, CheckCircleOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { getEvalAccuracy } from '../services/api';
import type { EvalAccuracy } from '../types/invoice';

function EvaluationPage() {
  const [data, setData] = useState<EvalAccuracy | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await getEvalAccuracy();
      setData(res);
    } catch (e: any) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div style={{ padding: 80, textAlign: 'center' }}><Spin size="large" tip="加载评估数据..." /></div>;

  if (!data || !data.annotated_count) {
    return (
      <div style={{ padding: 40, maxWidth: 1200, margin: '0 auto' }}>
        <h2 style={{ marginBottom: 24 }}><ExperimentOutlined style={{ marginRight: 8 }} />双引擎字段提取精度评估</h2>
        <Empty description="暂无标注数据">
          <p style={{ color: '#999' }}>在发票详情页点击「设为真值」，标注至少1张发票后刷新此页面</p>
        </Empty>
      </div>
    );
  }

  const colorMap = (v: number) => v >= 0.9 ? '#52c41a' : v >= 0.75 ? '#faad14' : '#ff4d4f';

  const fieldColumns = [
    { title: '字段', dataIndex: 'label', key: 'label', width: 160 },
    {
      title: 'OCR 准确率', dataIndex: 'ocr', key: 'ocr', width: 200,
      render: (v: number) => <Progress percent={Math.round(v * 100)} size="small" strokeColor={colorMap(v)} />,
    },
    {
      title: 'LLM 准确率', dataIndex: 'llm', key: 'llm', width: 200,
      render: (v: number) => <Progress percent={Math.round(v * 100)} size="small" strokeColor={colorMap(v)} />,
    },
    {
      title: '融合后准确率', dataIndex: 'fusion', key: 'fusion', width: 200,
      render: (v: number) => <Progress percent={Math.round(v * 100)} size="small" strokeColor={colorMap(v)} />,
    },
    {
      title: '样本', dataIndex: 'samples', key: 'samples', width: 60,
      render: (v: number) => <span style={{ color: '#999' }}>{v}</span>,
    },
  ];

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto' }}>
      <h2 style={{ marginBottom: 24 }}>
        <ExperimentOutlined style={{ marginRight: 8 }} />
        双引擎字段提取精度评估
        <Tag color="blue" style={{ marginLeft: 12 }}>{data.annotated_count} 张已标注</Tag>
      </h2>

      {/* Top stats */}
      <Row gutter={24} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card>
            <Statistic title="OCR 整体准确率" value={data.overall.ocr * 100} suffix="%" precision={1}
              valueStyle={{ color: colorMap(data.overall.ocr) }} prefix={<ThunderboltOutlined />} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="LLM 整体准确率" value={data.overall.llm * 100} suffix="%" precision={1}
              valueStyle={{ color: colorMap(data.overall.llm) }} prefix={<ExperimentOutlined />} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="融合后准确率" value={data.overall.fusion * 100} suffix="%" precision={1}
              valueStyle={{ color: colorMap(data.overall.fusion) }} prefix={<CheckCircleOutlined />} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="标注字段总数" value={data.total_fields} suffix="条" />
          </Card>
        </Col>
      </Row>

      {/* Per-field table */}
      <Card title="逐字段准确率对比" style={{ marginBottom: 24 }}>
        <Table dataSource={data.per_field} columns={fieldColumns} rowKey="field" pagination={false} size="middle" />
      </Card>

      {/* Cross-validation */}
      <Row gutter={24} style={{ marginBottom: 24 }}>
        <Col span={12}>
          <Card title="交叉验证分析">
            <Row gutter={[16, 16]}>
              <Col span={12}>
                <Statistic title="双引擎一致率" value={data.cross_validation.agree_rate * 100} suffix="%" precision={1} />
              </Col>
              <Col span={12}>
                <Statistic title="一致时两者都正确" value={data.cross_validation.agree_both_correct * 100} suffix="%" precision={1} valueStyle={{ color: '#52c41a' }} />
              </Col>
              <Col span={12}>
                <Statistic title="双引擎冲突率" value={data.cross_validation.disagree_rate * 100} suffix="%" precision={1} valueStyle={{ color: data.cross_validation.disagree_rate > 0.2 ? '#ff4d4f' : '#faad14' }} />
              </Col>
              <Col span={12}>
                <Statistic title="冲突时LLM正确" value={data.cross_validation.disagree_llm_correct * 100} suffix="%" precision={1} />
              </Col>
            </Row>
          </Card>
        </Col>
        <Col span={12}>
          <Card title="人工复核节省">
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <Progress
                type="circle"
                percent={Math.round(data.review_savings.auto_pass_rate * 100)}
                strokeColor="#52c41a"
                format={(p) => `${p}%`}
              />
              <p style={{ marginTop: 16, color: '#666', fontSize: 14 }}>
                双引擎一致且正确的字段可直接自动通过，无需人工复核
              </p>
              <Row gutter={16}>
                <Col span={12}>
                  <Statistic title="可自动通过" value={data.review_savings.auto_pass_count} suffix="字段" valueStyle={{ color: '#52c41a' }} />
                </Col>
                <Col span={12}>
                  <Statistic title="需人工复核" value={data.review_savings.need_review_count} suffix="字段" valueStyle={{ color: '#faad14' }} />
                </Col>
              </Row>
            </div>
          </Card>
        </Col>
      </Row>
    </div>
  );
}

export default EvaluationPage;
