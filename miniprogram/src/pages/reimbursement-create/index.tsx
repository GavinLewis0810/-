import { useEffect, useState } from 'react';
import Taro from '@tarojs/taro';
import { View, Text, Input, ScrollView, Picker, Checkbox } from '@tarojs/components';
import { listInvoices, getProjects, createReimbursement, suggestCategory } from '../../services/api';
import type { Invoice, ProjectItem } from '../../types';
import './index.scss';

export default function ReimbursementCreatePage() {
  const [title, setTitle] = useState('');
  const [selectedInvoices, setSelectedInvoices] = useState<Invoice[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [selectedProject, setSelectedProject] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchInvoices();
    fetchProjects();
  }, []);

  const fetchInvoices = async () => {
    try {
      const res = await listInvoices({ page_size: 50, status: '已确认' });
      setInvoices(res.items.filter(i => !i.reimbursement_id));
    } catch { /* */ }
  };

  const fetchProjects = async () => {
    try {
      setProjects(await getProjects());
    } catch { /* */ }
  };

  const toggleInvoice = (inv: Invoice) => {
    setSelectedInvoices(prev =>
      prev.find(i => i.id === inv.id)
        ? prev.filter(i => i.id !== inv.id)
        : [...prev, inv],
    );
  };

  const totalAmount = selectedInvoices.reduce((sum, i) => sum + Number(i.total_with_tax || 0), 0);

  const handleSubmit = async () => {
    if (!title.trim()) { Taro.showToast({ title: '请输入报销事由', icon: 'none' }); return; }
    if (selectedInvoices.length === 0) { Taro.showToast({ title: '请选择发票', icon: 'none' }); return; }

    setSubmitting(true);
    try {
      await createReimbursement({
        title: title.trim(),
        invoice_ids: selectedInvoices.map(i => i.id),
        project_code: selectedProject || undefined,
      });
      Taro.showToast({ title: '创建成功', icon: 'success' });
      setTimeout(() => Taro.switchTab({ url: '/pages/reimbursements/index' }), 1000);
    } catch (err: any) {
      Taro.showToast({ title: err.message || '创建失败', icon: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View className='page'>
      <ScrollView scrollY style={{ paddingBottom: '140px' }}>
        {/* 事由 */}
        <View className='card'>
          <Text className='card-title'>报销事由</Text>
          <Input
            className='title-input'
            placeholder='例如：参加人工智能大会差旅费'
            placeholderClass='placeholder'
            value={title}
            onInput={e => setTitle(e.detail.value)}
          />
        </View>

        {/* 选择项目 */}
        <View className='card'>
          <Text className='card-title'>所属项目</Text>
          <Picker
            mode='selector'
            range={projects.map(p => `${p.project_code} (余额: ¥${Number(p.remaining).toLocaleString()})`)}
            onChange={e => setSelectedProject(projects[Number(e.detail.value)]?.project_code || '')}
          >
            <View className='picker-box'>
              <Text className={selectedProject ? 'picker-value' : 'picker-placeholder'}>
                {selectedProject || '选择项目（可选）'}
              </Text>
            </View>
          </Picker>
        </View>

        {/* 选择发票 */}
        <View className='card'>
          <Text className='card-title'>选择发票（已选 {selectedInvoices.length} 张）</Text>
          {invoices.length === 0 ? (
            <Text className='no-data'>没有可用的已确认发票</Text>
          ) : (
            invoices.map(inv => (
              <View key={inv.id} className='invoice-row' onClick={() => toggleInvoice(inv)}>
                <View className={`check-box ${selectedInvoices.find(i => i.id === inv.id) ? 'checked' : ''}`}>
                  {selectedInvoices.find(i => i.id === inv.id) && <Text className='check-mark'>✓</Text>}
                </View>
                <View className='inv-info'>
                  <Text className='inv-filename' numberOfLines={1}>{inv.file_name}</Text>
                  <Text className='inv-meta'>{inv.invoice_number || '无发票号'} · {inv.issue_date?.slice(0, 10)}</Text>
                </View>
                <Text className='inv-price'>¥{Number(inv.total_with_tax || 0).toLocaleString()}</Text>
              </View>
            ))
          )}
        </View>

        {/* 合计 */}
        <View className='total-bar'>
          <Text className='total-label'>报销总额</Text>
          <Text className='total-amount'>¥{totalAmount.toLocaleString()}</Text>
        </View>
      </ScrollView>

      {/* 提交按钮 */}
      <View className='submit-bar'>
        <View className='submit-info'>
          <Text className='submit-count'>{selectedInvoices.length} 张发票</Text>
          <Text className='submit-amount'>¥{totalAmount.toLocaleString()}</Text>
        </View>
        <View className='submit-btn' onClick={submitting ? undefined : handleSubmit}>
          <Text className='submit-text'>{submitting ? '提交中...' : '提交报销'}</Text>
        </View>
      </View>
    </View>
  );
}
