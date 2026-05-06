import { useState, useEffect } from 'react';
import { Table, Button, Space, message, Modal, Input, Select, InputNumber, Tag, Popconfirm, Switch } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  getApprovalRules, createApprovalRule, updateApprovalRule,
  deleteApprovalRule, ApprovalRuleItem,
} from '../services/api';

const ACTION_LABELS: Record<string, string> = {
  AUTO_APPROVE: '自动通过',
  AUTO_REJECT: '自动驳回',
  WARN_ONLY: '仅警告',
  NONE: '无动作',
};

const ACTION_COLORS: Record<string, string> = {
  AUTO_APPROVE: 'success',
  AUTO_REJECT: 'error',
  WARN_ONLY: 'warning',
  NONE: 'default',
};

export default function RuleEnginePage() {
  const [rules, setRules] = useState<ApprovalRuleItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ApprovalRuleItem | null>(null);

  // 表单状态
  const [name, setName] = useState('');
  const [priority, setPriority] = useState(100);
  const [action, setAction] = useState('AUTO_APPROVE');
  const [isActive, setIsActive] = useState(true);
  // 简易条件：只支持单层 AND，两个字段
  const [condField, setCondField] = useState('total_amount');
  const [condOp, setCondOp] = useState('<');
  const [condValue, setCondValue] = useState('500');
  const [condField2, setCondField2] = useState('ai_risk_level');
  const [condOp2, setCondOp2] = useState('in');
  const [condValue2, setCondValue2] = useState('低风险');

  const fetch = async () => {
    setLoading(true);
    try { setRules(await getApprovalRules()); } catch { message.error('获取规则失败'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetch(); }, []);

  const resetForm = () => {
    setName(''); setPriority(100); setAction('AUTO_APPROVE'); setIsActive(true);
    setCondField('total_amount'); setCondOp('<'); setCondValue('500');
    setCondField2('ai_risk_level'); setCondOp2('in'); setCondValue2('低风险');
    setEditing(null);
  };

  const buildConditions = () => {
    const rules: any[] = [
      { field: condField, op: condOp, value: condField === 'total_amount' ? Number(condValue) : condValue },
    ];
    if (condField2) {
      rules.push({
        field: condField2, op: condOp2,
        value: condField2 === 'total_amount' ? Number(condValue2) : (condOp2 === 'in' ? condValue2.split(',') : condValue2),
      });
    }
    return { operator: 'AND', rules };
  };

  const parseConditions = (conds: any) => {
    if (!conds?.rules) return;
    const r0 = conds.rules[0];
    if (r0) { setCondField(r0.field || ''); setCondOp(r0.op || '=='); setCondValue(String(r0.value || '')); }
    const r1 = conds.rules[1];
    if (r1) { setCondField2(r1.field || ''); setCondOp2(r1.op || '=='); setCondValue2(Array.isArray(r1.value) ? r1.value.join(',') : String(r1.value || '')); }
    else { setCondField2(''); setCondOp2('=='); setCondValue2(''); }
  };

  const handleSave = async () => {
    if (!name.trim()) { message.warning('请输入规则名称'); return; }
    const conditions = buildConditions();
    const payload = { name, entity_type: 'reimbursement', priority, conditions, action, is_active: isActive };
    try {
      if (editing) {
        await updateApprovalRule(editing.id, payload);
        message.success('已更新');
      } else {
        await createApprovalRule(payload);
        message.success('已创建');
      }
      setModalOpen(false); resetForm(); fetch();
    } catch (e: any) { message.error(e.response?.data?.detail || '保存失败'); }
  };

  const columns: ColumnsType<ApprovalRuleItem> = [
    { title: '优先级', dataIndex: 'priority', key: 'priority', width: 70 },
    { title: '规则名称', dataIndex: 'name', key: 'name' },
    { title: '条件', key: 'conditions', ellipsis: true,
      render: (_, r) => {
        const cs = r.conditions?.rules;
        if (!cs?.length) return '-';
        return cs.map((c: any) => {
          const val = Array.isArray(c.value) ? c.value.join(', ') : String(c.value);
          return `${c.field} ${c.op} ${val}`;
        }).join(' 且 ');
      },
    },
    { title: '动作', dataIndex: 'action', key: 'action', width: 100,
      render: (a: string) => <Tag color={ACTION_COLORS[a] || 'default'}>{ACTION_LABELS[a] || a}</Tag>,
    },
    { title: '启用', dataIndex: 'is_active', key: 'is_active', width: 60, align: 'center',
      render: (v: boolean) => v ? <Tag color="green">开</Tag> : <Tag color="default">关</Tag>,
    },
    { title: '操作', key: 'act', width: 120,
      render: (_, r) => (
        <Space size="small">
          <Button type="link" size="small" icon={<EditOutlined />}
            onClick={() => {
              setEditing(r); setName(r.name); setPriority(r.priority);
              setAction(r.action); setIsActive(r.is_active);
              parseConditions(r.conditions);
              setModalOpen(true);
            }} />
          <Popconfirm title="确定删除？" onConfirm={async () => {
            try { await deleteApprovalRule(r.id); fetch(); } catch { message.error('删除失败'); }
          }}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0 }}>动态审批规则引擎</h2>
          <p style={{ color: '#999', margin: '4px 0 0' }}>
            配置自动审批规则。命中后自动执行动作，未命中走人工审批。
          </p>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { resetForm(); setModalOpen(true); }}>
          新建规则
        </Button>
      </div>

      <Table rowKey="id" columns={columns} dataSource={rules} loading={loading} pagination={false}
        locale={{ emptyText: '暂无规则，所有报销单走人工审批' }} />

      <Modal
        title={editing ? '编辑规则' : '新建规则'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => { setModalOpen(false); resetForm(); }}
        okText="保存" cancelText="取消"
        width={560}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 }}>
          <Input placeholder="规则名称（如：小额低风险秒批）" value={name}
            onChange={e => setName(e.target.value)} />
          <Space>
            <span style={{ width: 60, display: 'inline-block' }}>优先级</span>
            <InputNumber min={1} max={999} value={priority} onChange={v => setPriority(v || 100)} />
            <span style={{ color: '#999', fontSize: 12 }}>越小越优先</span>
          </Space>

          {/* 条件一 */}
          <fieldset style={{ border: '1px solid #d9d9d9', borderRadius: 6, padding: '8px 12px' }}>
            <legend style={{ fontSize: 13, fontWeight: 600 }}>条件一</legend>
            <Space>
              <Select value={condField} onChange={setCondField} style={{ width: 140 }}
                options={[
                  { value: 'total_amount', label: '报销金额' },
                  { value: 'ai_risk_level', label: 'AI风险等级' },
                  { value: 'compliance_status', label: '合规状态' },
                ]} />
              <Select value={condOp} onChange={setCondOp} style={{ width: 80 }}
                options={[
                  { value: '<', label: '<' }, { value: '<=', label: '<=' },
                  { value: '>', label: '>' }, { value: '>=', label: '>=' },
                  { value: '==', label: '==' }, { value: '!=', label: '!=' },
                  { value: 'in', label: 'in' },
                ]} />
              <Input value={condValue} onChange={e => setCondValue(e.target.value)}
                placeholder="500 / 低风险 / 合规" style={{ width: 180 }} />
            </Space>
          </fieldset>

          {/* 条件二（可选） */}
          <fieldset style={{ border: '1px solid #d9d9d9', borderRadius: 6, padding: '8px 12px' }}>
            <legend style={{ fontSize: 13, fontWeight: 600 }}>条件二（选填）</legend>
            <Space>
              <Select value={condField2 || ''} onChange={v => setCondField2(v || '')} style={{ width: 140 }} allowClear
                options={[
                  { value: 'total_amount', label: '报销金额' },
                  { value: 'ai_risk_level', label: 'AI风险等级' },
                  { value: 'compliance_status', label: '合规状态' },
                ]} />
              <Select value={condOp2} onChange={setCondOp2} style={{ width: 80 }}
                options={[
                  { value: '<', label: '<' }, { value: '<=', label: '<=' },
                  { value: '>', label: '>' }, { value: '>=', label: '>=' },
                  { value: '==', label: '==' }, { value: '!=', label: '!=' },
                  { value: 'in', label: 'in' },
                ]} />
              <Input value={condValue2} onChange={e => setCondValue2(e.target.value)}
                placeholder="低风险 / 合规 / 500" style={{ width: 180 }} />
            </Space>
          </fieldset>

          <Space>
            <span style={{ width: 60, display: 'inline-block' }}>动作</span>
            <Select value={action} onChange={setAction} style={{ width: 160 }}
              options={[
                { value: 'AUTO_APPROVE', label: '自动通过' },
                { value: 'AUTO_REJECT', label: '自动驳回' },
                { value: 'WARN_ONLY', label: '仅警告' },
              ]} />
          </Space>

          <Space>
            <span style={{ width: 60, display: 'inline-block' }}>启用</span>
            <Switch checked={isActive} onChange={setIsActive} />
          </Space>
        </div>
      </Modal>
    </div>
  );
}
