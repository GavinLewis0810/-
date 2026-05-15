import { useState, useEffect, useCallback } from 'react';
import { Card, Row, Col, Table, Spin, Empty, Statistic, Tag } from 'antd';
import { TrophyOutlined, EnvironmentOutlined } from '@ant-design/icons';
import { getCarbonMyStats, getCarbonRanking } from '../services/api';
import type { CarbonMyStats, CarbonRankItem } from '../types/invoice';

function CarbonFootprintPage() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<CarbonMyStats | null>(null);
  const [ranking, setRanking] = useState<CarbonRankItem[]>([]);
  const [apiError, setApiError] = useState(false);

  const userStr = localStorage.getItem('currentUser');
  const currentUser = userStr ? JSON.parse(userStr) : null;
  const isAdmin = currentUser?.role === 'admin';

  const fetchData = useCallback(async () => {
    if (isAdmin) { setLoading(false); return; }
    setLoading(true);
    setApiError(false);
    try {
      const [s, r] = await Promise.all([getCarbonMyStats(1), getCarbonRanking(1)]);
      setStats(s);
      setRanking(r);
    } catch { setApiError(true); }
    setLoading(false);
  }, [isAdmin]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 100 }}><Spin size="large" /></div>;
  }

  // 管理员不参与碳足迹
  if (isAdmin) {
    return (
      <div style={{ padding: 24, maxWidth: 800, margin: '0 auto' }}>
        <Card style={{ textAlign: 'center', padding: 60 }}>
          <EnvironmentOutlined style={{ fontSize: 64, color: '#52c41a', marginBottom: 24 }} />
          <h2 style={{ color: '#333' }}>管理员不参与碳足迹排名</h2>
          <p style={{ color: '#888', fontSize: 14, marginTop: 12 }}>
            碳足迹追踪面向普通员工，通过可视化碳排放数据与社会比较机制，
            引导员工自发选择低碳出行方式。管理员账号用于系统管理，不纳入排名统计。
          </p>
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

  const rankColumns = [
    { title: '排名', dataIndex: 'rank', key: 'rank', width: 60,
      render: (v: number) => {
        if (v === 1) return '🥇';
        if (v === 2) return '🥈';
        if (v === 3) return '🥉';
        return v;
      }
    },
    { title: '姓名', dataIndex: 'full_name', key: 'name', render: (v: string, r: CarbonRankItem) => (
      <span style={{ fontWeight: r.username === currentUser?.username ? 'bold' : 'normal' }}>
        {v || r.username}{r.username === currentUser?.username ? ' (你)' : ''}
      </span>
    )},
    { title: '部门', dataIndex: 'department', key: 'dept', render: (v: string) => v || '-' },
    { title: '🌿 绿色积分', dataIndex: 'green_points', key: 'points',
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
