import { useState, useEffect, useCallback } from 'react';
import { Card, Row, Col, Table, Spin, Empty, Statistic, Tag } from 'antd';
import { TrophyOutlined, EnvironmentOutlined } from '@ant-design/icons';
import { getCarbonMyStats, getCarbonRanking, getCarbonCompanyStats } from '../services/api';
import type { CarbonMyStats, CarbonRankItem, CarbonCompanyStats } from '../types/invoice';

function CarbonFootprintPage() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<CarbonMyStats | null>(null);
  const [ranking, setRanking] = useState<CarbonRankItem[]>([]);
  const [companyStats, setCompanyStats] = useState<CarbonCompanyStats | null>(null);
  const [apiError, setApiError] = useState(false);

  const userStr = localStorage.getItem('currentUser');
  const currentUser = userStr ? JSON.parse(userStr) : null;
  const isAdmin = currentUser?.role === 'admin';

  const fetchData = useCallback(async () => {
    setLoading(true);
    setApiError(false);
    try {
      if (isAdmin) {
        const [c, r] = await Promise.all([getCarbonCompanyStats(1), getCarbonRanking(1)]);
        setCompanyStats(c);
        setRanking(r);
      } else {
        const [s, r] = await Promise.all([getCarbonMyStats(1), getCarbonRanking(1)]);
        setStats(s);
        setRanking(r);
      }
    } catch { setApiError(true); }
    setLoading(false);
  }, [isAdmin]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 100 }}><Spin size="large" /></div>;
  }

  const rankColumns = [
    { title: '排名', dataIndex: 'rank', key: 'rank', width: 60,
      render: (v: number) => {
        if (v === 1) return '\u{1F947}';
        if (v === 2) return '\u{1F948}';
        if (v === 3) return '\u{1F949}';
        return v;
      }
    },
    { title: '姓名', dataIndex: 'full_name', key: 'name', render: (v: string, r: CarbonRankItem) => (
      <span style={{ fontWeight: r.username === currentUser?.username ? 'bold' : 'normal' }}>
        {v || r.username}{r.username === currentUser?.username ? ' (你)' : ''}
      </span>
    )},
    { title: '部门', dataIndex: 'department', key: 'dept', render: (v: string) => v || '-' },
    { title: '绿色积分', dataIndex: 'green_points', key: 'points',
      render: (v: number, r: CarbonRankItem) => (
        <span>
          <span style={{ color: '#52c41a', fontWeight: 'bold', fontSize: 16 }}>{v}</span>
          <span style={{ fontSize: 11, color: '#999', marginLeft: 4 }}>
            ({r.point_sources?.join(', ') || '无纸化'})
          </span>
        </span>
      )
    },
    { title: '碳排放(参考)', dataIndex: 'total_carbon_kg', key: 'carbon',
      render: (v: number) => <span style={{ color: '#999' }}>{v.toFixed(1)} kg</span>
    },
    { title: '发票数', dataIndex: 'invoice_count', key: 'cnt', width: 70 },
  ];

  // 管理员：查看全公司碳足迹总览 + 员工排名
  if (isAdmin) {
    if (apiError) {
      return (
        <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
          <Card><Empty description="数据加载失败，请检查后端是否正常运行" /></Card>
        </div>
      );
    }

    if (!companyStats || companyStats.total_carbon_kg === 0) {
      return (
        <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
          <Card><Empty description="暂无公司碳足迹数据" /></Card>
        </div>
      );
    }

    return (
      <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
        <Card
          style={{ marginBottom: 16, background: '#e6f7ff', border: '1px solid #91d5ff' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <EnvironmentOutlined style={{ fontSize: 20, color: '#1677ff' }} />
            <span style={{ color: '#1677ff', fontWeight: 500 }}>
              管理员不参与碳足迹排名，以下为全公司数据总览
            </span>
          </div>
        </Card>

        {/* 公司级 KPI 卡片 */}
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={8}>
            <Card>
              <Statistic title="🌿 公司总碳排放"
                value={companyStats.total_carbon_kg.toFixed(1)}
                suffix="kg CO₂" valueStyle={{ color: '#666', fontSize: 36 }} />
            </Card>
          </Col>
          <Col span={8}>
            <Card>
              <Statistic title="🌳 需植树总量"
                value={companyStats.total_tree_offset}
                suffix="棵" valueStyle={{ color: '#52c41a', fontSize: 36 }} />
            </Card>
          </Col>
          <Col span={8}>
            <Card>
              <Statistic title="👥 人均碳排放"
                value={companyStats.avg_carbon_per_user.toFixed(1)}
                suffix="kg / 人" valueStyle={{ color: '#1677ff', fontSize: 36 }} />
            </Card>
          </Col>
        </Row>

        {/* 类别分布 + 减排知识 */}
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={12}>
            <Card title="📊 消费类别分布（全公司）">
              {companyStats.category_breakdown.length === 0 ? (
                <Empty description="暂无数据" />
              ) : (
                companyStats.category_breakdown.map((cat, i) => {
                  const pct = companyStats.total_carbon_kg > 0
                    ? (cat.carbon_kg / companyStats.total_carbon_kg * 100).toFixed(1) : '0';
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
                      <Tag color="green">{cat.category}</Tag>
                      <div style={{ flex: 1, height: 10, background: '#f0f0f0', borderRadius: 5, margin: '0 12px' }}>
                        <div style={{
                          height: '100%', background: '#52c41a', borderRadius: 5,
                          width: `${pct}%`, minWidth: pct > '0' ? 2 : 0,
                        }} />
                      </div>
                      <span style={{ width: 60, textAlign: 'right', fontSize: 13, color: '#555' }}>
                        {cat.carbon_kg.toFixed(1)} kg
                      </span>
                      <span style={{ width: 40, textAlign: 'right', fontSize: 12, color: '#999' }}>{pct}%</span>
                    </div>
                  );
                })
              )}
            </Card>
          </Col>
          <Col span={12}>
            <Card title="💡 全员减排建议">
              <div style={{ padding: 16, background: '#f6ffed', borderRadius: 8, border: '1px solid #b7eb8f' }}>
                <p style={{ fontSize: 15, color: '#389e0d', lineHeight: 1.8, margin: 0 }}>
                  建议员工优先选择高铁代替飞机出行，每次可减少约 60% 碳排放；
                  短途出行选择公共交通，碳排放可降低 75%。
                </p>
              </div>
              <div style={{ marginTop: 16, padding: 16, background: '#fafafa', borderRadius: 8 }}>
                <h4 style={{ marginTop: 0 }}>🌳 碳抵消小知识</h4>
                <p style={{ fontSize: 13, color: '#666', lineHeight: 1.8, margin: 0 }}>
                  一棵树每年约吸收 15 kg CO₂。
                  公司本月需种植 {companyStats.total_tree_offset} 棵树来抵消总碳排放。
                  选择高铁代替飞机出行，每次可减少约 60% 碳排放；
                  短途出行选择公共交通，碳排放可降低 75%。
                </p>
              </div>
            </Card>
          </Col>
        </Row>

        {/* 全公司绿色贡献排名 */}
        <Card
          title={<span><TrophyOutlined style={{ color: '#faad14', marginRight: 8 }} />全公司绿色贡献排名（按积分降序，管理员不参与）</span>}
        >
          <Table
            dataSource={ranking}
            columns={rankColumns}
            rowKey="rank"
            pagination={false}
            size="middle"
          />
        </Card>
      </div>
    );
  }

  if (apiError) {
    return (
      <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
        <Card>
          <Empty description="数据加载失败，请检查后端是否正常运行" />
        </Card>
      </div>
    );
  }

  if (!stats || stats.total_carbon_kg === 0) {
    return (
      <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
        <Card>
          <Empty description={
            <span>
              暂无碳足迹数据<br />
              <span style={{ fontSize: 12, color: '#999' }}>
                请对已确认的发票点击「重新解析」以生成碳足迹数据
              </span>
            </span>
          } />
        </Card>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      {/* 顶部概览卡片 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Card>
            <Statistic title="🌿 本月绿色积分" value={stats.green_points}
              suffix="分" valueStyle={{ color: '#52c41a', fontSize: 36 }} />
            <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
              {stats.point_sources?.join(' · ') || '无纸化'}
            </div>
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic title="📊 碳排放（参考）" value={stats.total_carbon_kg.toFixed(1)}
              suffix="kg CO₂" valueStyle={{ color: '#666', fontSize: 36 }} />
            <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>
              需植树 {stats.tree_offset} 棵 🌳
            </div>
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic title="🏆 绿色贡献排名"
              value={`#${stats.rank}`}
              suffix={<span style={{ fontSize: 14 }}> / {ranking.length} 人</span>}
              valueStyle={{ color: '#1677ff', fontSize: 36 }} />
            <div style={{ fontSize: 13, color: '#888', marginTop: 4 }}>
              超越 {stats.rank_percentile}% 的同事
              {stats.rank_percentile >= 80 ? ' 🏆' : stats.rank_percentile >= 50 ? ' 👍' : ' 💪'}
            </div>
          </Card>
        </Col>
      </Row>

      {/* 类别分布 + 减排建议 */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={12}>
          <Card title="📊 消费类别分布">
            {stats.category_breakdown.length === 0 ? (
              <Empty description="暂无数据" />
            ) : (
              stats.category_breakdown.map((cat, i) => {
                const pct = stats.total_carbon_kg > 0
                  ? (cat.carbon_kg / stats.total_carbon_kg * 100).toFixed(1) : '0';
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
                    <Tag color="green">{cat.category}</Tag>
                    <div style={{ flex: 1, height: 10, background: '#f0f0f0', borderRadius: 5, margin: '0 12px' }}>
                      <div style={{
                        height: '100%', background: '#52c41a', borderRadius: 5,
                        width: `${pct}%`, minWidth: pct > '0' ? 2 : 0,
                      }} />
                    </div>
                    <span style={{ width: 60, textAlign: 'right', fontSize: 13, color: '#555' }}>
                      {cat.carbon_kg.toFixed(1)} kg
                    </span>
                    <span style={{ width: 40, textAlign: 'right', fontSize: 12, color: '#999' }}>{pct}%</span>
                  </div>
                );
              })
            )}
          </Card>
        </Col>
        <Col span={12}>
          <Card title="💡 减排建议">
            <div style={{ padding: 16, background: '#f6ffed', borderRadius: 8, border: '1px solid #b7eb8f' }}>
              <p style={{ fontSize: 15, color: '#389e0d', lineHeight: 1.8, margin: 0 }}>
                {stats.suggestion}
              </p>
            </div>
            <div style={{ marginTop: 16, padding: 16, background: '#fafafa', borderRadius: 8 }}>
              <h4 style={{ marginTop: 0 }}>🌳 碳抵消小知识</h4>
              <p style={{ fontSize: 13, color: '#666', lineHeight: 1.8, margin: 0 }}>
                一棵树每年约吸收 {stats.tree_offset > 0 ? '15' : '-'} kg CO₂。
                {stats.tree_offset > 0
                  ? `您本月需种植 ${stats.tree_offset} 棵树来抵消碳排放。`
                  : ''}
                选择高铁代替飞机出行，每次可减少约 60% 碳排放；
                短途出行选择公共交通，碳排放可降低 75%。
              </p>
            </div>
          </Card>
        </Col>
      </Row>

      {/* 全公司低碳排名 */}
      <Card
        title={<span><TrophyOutlined style={{ color: '#faad14', marginRight: 8 }} />全公司绿色贡献排名（按积分降序）</span>}
        style={{ marginBottom: 16 }}
      >
        <Table
          dataSource={ranking}
          columns={rankColumns}
          rowKey="rank"
          pagination={false}
          size="middle"
          rowClassName={(record) =>
            record.username === currentUser?.username ? 'carbon-my-row' : ''
          }
        />
      </Card>
    </div>
  );
}

export default CarbonFootprintPage;
