import { useEffect, useState, useMemo } from 'react';
import Taro, { useRouter } from '@tarojs/taro';
import { View, Text, ScrollView, Image, Input, Button } from '@tarojs/components';
import { getInvoice, confirmInvoice } from '../../services/api';
import type { Invoice } from '../../types';
import './index.scss';

const HOST_URL = 'http://10.105.12.33:18080';

const FIELD_LIST: { field: string; label: string; isMono?: boolean; isAmount?: boolean }[] = [
  { field: 'invoice_number', label: '发票号码', isMono: true },
  { field: 'issue_date', label: '开票日期' },
  { field: 'buyer_name', label: '购买方' },
  { field: 'seller_name', label: '销售方' },
  { field: 'total_with_tax', label: '价税合计', isAmount: true },
  { field: 'amount', label: '不含税金额', isAmount: true },
  { field: 'tax_rate', label: '税率' },
  { field: 'tax_amount', label: '税额', isAmount: true },
];

const statusClassMap: Record<string, string> = {
  '已上传': 'upl', '解析中': 'proc', '待处理': 'pend',
  '已确认': 'conf', '已报销': 'reim', '待确认': 'pend', '待重审': 'warn', '待随单审核': 'warn',
};

export default function InvoiceDetailPage() {
  const { id } = useRouter().params;
  const [inv, setInv] = useState<Invoice | null>(null);
  const [editing, setEditing] = useState(false);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (id) fetchDetail();
  }, [id]);

  const fetchDetail = async () => {
    try {
      const detail = await getInvoice(Number(id));
      setInv(detail);
      const vals: Record<string, string> = {};
      for (const f of FIELD_LIST) {
        const v = (detail as any)[f.field];
        vals[f.field] = v != null ? String(v) : '';
      }
      setEditValues(vals);
    } catch {
      Taro.showToast({ title: '加载失败', icon: 'error' });
    }
  };

  const fieldStates = useMemo(() => inv?.field_states || {}, [inv]);

  const getStatusBadge = (field: string): { icon: string; cls: string; label: string } | null => {
    const s = fieldStates[field];
    if (!s) return null;
    if (s.status === 'locked') return { icon: '🔒', cls: 'badge-locked', label: `双引擎一致 ${Math.round((s.confidence || 1) * 100)}%` };
    if (s.status === 'conflict') return { icon: '⚠️', cls: 'badge-conflict', label: '双引擎不一致，需管理员审核' };
    return { icon: '✏️', cls: 'badge-editable', label: `可修正 ${Math.round((s.confidence || 0.8) * 100)}%` };
  };

  const isFieldEditable = (field: string) => {
    const s = fieldStates[field];
    return s && s.status !== 'locked' && s.status !== 'conflict';
  };

  const hasCorrections = useMemo(() => {
    for (const f of FIELD_LIST) {
      if (!isFieldEditable(f.field)) continue;
      const orig = fieldStates[f.field]?.ocr ?? fieldStates[f.field]?.llm ?? '';
      if (editValues[f.field] !== String(orig)) return true;
    }
    return false;
  }, [editValues, fieldStates]);

  const canConfirm = inv && (inv.status === '待确认' || inv.status === '待处理');

  const handleConfirm = async () => {
    if (!id || !inv) return;
    setSubmitting(true);
    try {
      // 收集修正值
      const corrections: Record<string, string> = {};
      for (const f of FIELD_LIST) {
        if (!isFieldEditable(f.field)) continue;
        const orig = fieldStates[f.field]?.ocr ?? fieldStates[f.field]?.llm ?? '';
        if (editValues[f.field] !== String(orig)) {
          corrections[f.field] = editValues[f.field];
        }
      }
      const res = await confirmInvoice(Number(id), corrections);
      if (res.confirmation_mode === 'USER_EDIT') {
        Taro.showModal({
          title: '已提交',
          content: `修改了 ${res.corrected_fields.length} 个字段，已转管理员复核。`,
          showCancel: false,
        });
      } else if (res.confirmation_mode === 'USER_SELECTION') {
        Taro.showModal({
          title: '已提交',
          content: `包含 OCR/LLM/自定义人工选择，状态已进入“待随单审核”。`,
          showCancel: false,
        });
      } else {
        Taro.showToast({ title: '确认成功', icon: 'success' });
      }
      fetchDetail();
    } catch (e: any) {
      Taro.showToast({ title: e?.message || '确认失败', icon: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditValue = (field: string, value: string) => {
    setEditValues(prev => ({ ...prev, [field]: value }));
  };

  if (!inv) {
    return (
      <View className='invoice-detail-page'>
        <View className='loading-box'>
          <Text className='loading-spinner'></Text>
          <Text className='loading-text'>智能识别结果加载中...</Text>
        </View>
      </View>
    );
  }

  const imageUrl = `${HOST_URL}/api/invoices/${inv.id}/file`;

  return (
    <ScrollView className='invoice-detail-page' scrollY>
      <View className='detail-container'>

        {/* 发票图片预览 */}
        <View className='ui-card preview-card'>
          <View className='card-header-mini'>
            <Text className='header-title-text'>📄 原始凭证电子影像</Text>
            <Text className='header-action-text'>点击全屏查看</Text>
          </View>
          <View className='image-box' onClick={() => Taro.previewImage({ urls: [imageUrl] })}>
            <Image className='invoice-preview-img' src={imageUrl} mode='widthFix' />
          </View>
        </View>

        {/* 字段确认卡片 */}
        <View className='ui-card info-card'>
          <View className='card-header-main'>
            <Text className='header-title-text'>🔍 智能识别结果</Text>
            {canConfirm && (
              <View className='header-actions'>
                <Button
                  size='mini'
                  onClick={() => setEditing(!editing)}
                  className='btn-outline'
                >
                  {editing ? '取消核对' : '核对确认'}
                </Button>
              </View>
            )}
          </View>

          {editing && (
            <View className='edit-notice'>
              <Text>请对照发票图像逐字段核实。🔒锁定字段不可修改，✏️可修正字段改动后将标记为"用户修正"并转管理员复核。</Text>
            </View>
          )}

          <View className='fields-list'>
            {FIELD_LIST.map(f => {
              const badge = getStatusBadge(f.field);
              const readOnly = !editing || !isFieldEditable(f.field);
              const val = editValues[f.field];

              return (
                <View key={f.field} className={`field-row ${f.isAmount ? 'row-amount-highlight' : ''} ${badge?.cls || ''}`}>
                  <Text className='field-label'>
                    {f.label}
                    {badge && <Text className={`field-badge ${badge.cls}`}>{badge.icon}</Text>}
                  </Text>

                  {readOnly ? (
                    <Text className={`field-value ${f.isMono ? 'font-mono' : ''} ${f.isAmount ? 'amount-text' : ''}`}>
                      {f.isAmount && val ? `¥${Number(val).toLocaleString()}` : (val || '-')}
                    </Text>
                  ) : (
                    <Input
                      className={`field-input ${f.isMono ? 'font-mono' : ''}`}
                      value={val}
                      onInput={(e) => handleEditValue(f.field, e.detail.value)}
                      placeholder={badge?.label}
                    />
                  )}
                </View>
              );
            })}

            {/* 状态行 */}
            <View className='field-row'>
              <Text className='field-label'>状态</Text>
              <Text className={`status-tag tag-${statusClassMap[inv.status] || 'pend'}`}>
                {inv.status}
              </Text>
            </View>

            {/* 碳足迹 */}
            {inv.spend_category && (
              <View className='field-row'>
                <Text className='field-label'>🌿 消费类别</Text>
                <Text className='field-value'>{inv.spend_category}</Text>
              </View>
            )}
            {inv.carbon_kg != null && (
              <View className='field-row'>
                <Text className='field-label'>🌿 碳足迹</Text>
                <Text className='carbon-value-text'>{Number(inv.carbon_kg).toFixed(2)} kg CO₂</Text>
              </View>
            )}
          </View>

          {/* 确认按钮 */}
          {editing && (
            <View className='confirm-bar'>
              <Button
                className='btn-primary'
                loading={submitting}
                disabled={submitting}
                onClick={handleConfirm}
              >
                {hasCorrections ? '提交确认（含修正，需管理员复核）' : '✅ 确认无误'}
              </Button>
            </View>
          )}
        </View>

        {/* 商品明细 */}
        {inv.items && inv.items.length > 0 && (
          <View className='ui-card items-card'>
            <View className='card-header-main'>
              <Text className='header-title-text'>📦 商品明细</Text>
            </View>
            <View className='items-list-wrapper'>
              {(inv.items || []).map((item, idx) => (
                <View key={idx} className='item-detail-row'>
                  <View className='item-top-row'>
                    <View className='item-badge'>{idx + 1}</View>
                    <Text className='item-name-text' numberOfLines={1}>{item.item_name || '-'}</Text>
                  </View>
                  <View className='item-bottom-row'>
                    <Text className='item-formula-text'>
                      {item.quantity ? `${item.quantity} × ` : ''}¥{Number(item.unit_price || 0).toLocaleString()}
                    </Text>
                    <Text className='item-subtotal-text'>¥{Number(item.amount || 0).toLocaleString()}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

      </View>
    </ScrollView>
  );
}
