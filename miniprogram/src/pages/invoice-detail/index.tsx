import { useEffect, useState } from 'react';
import Taro, { useRouter } from '@tarojs/taro';
import { View, Text, ScrollView, Image } from '@tarojs/components';
import { getInvoice } from '../../services/api';
import type { InvoiceDetail } from '../../types';
import './index.scss';

export default function InvoiceDetailPage() {
  const { id } = useRouter().params;
  const [inv, setInv] = useState<InvoiceDetail | null>(null);

  useEffect(() => {
    if (id) fetchDetail();
  }, [id]);

  const fetchDetail = async () => {
    try {
      const detail = await getInvoice(Number(id));
      setInv(detail);
    } catch {
      Taro.showToast({ title: '加载失败', icon: 'error' });
    }
  };

  if (!inv) {
    return (
      <View className='page'>
        <View className='loading'>加载中...</View>
      </View>
    );
  }

  const fields = [
    { label: '发票号码', value: inv.invoice_number || '-' },
    { label: '开票日期', value: inv.issue_date || '-' },
    { label: '购买方', value: inv.buyer_name || '-' },
    { label: '销售方', value: inv.seller_name || '-' },
    { label: '价税合计', value: inv.total_with_tax != null ? `¥${Number(inv.total_with_tax).toLocaleString()}` : '-' },
    { label: '不含税金额', value: inv.amount != null ? `¥${Number(inv.amount).toLocaleString()}` : '-' },
    { label: '税率', value: inv.tax_rate || '-' },
    { label: '税额', value: inv.tax_amount != null ? `¥${Number(inv.tax_amount).toLocaleString()}` : '-' },
    { label: '状态', value: inv.status },
    { label: '消费类别', value: inv.spend_category || '-' },
    { label: '碳足迹', value: inv.carbon_kg != null ? `${Number(inv.carbon_kg).toFixed(2)} kg CO₂` : '-' },
  ];

  return (
    <ScrollView className='page' scrollY>
      {/* 发票图片预览 */}
      <View className='preview-box' onClick={() => {
        Taro.previewImage({
          urls: [`http://127.0.0.1:18080/api/invoices/${inv.id}/file`],
        });
      }}>
        <Image
          className='preview-img'
          src={`http://127.0.0.1:18080/api/invoices/${inv.id}/file`}
          mode='widthFix'
        />
        <Text className='preview-hint'>点击查看大图</Text>
      </View>

      {/* 字段信息 */}
      <View className='info-card'>
        <Text className='section-title'>发票信息</Text>
        {fields.map(f => (
          <View key={f.label} className='field-row'>
            <Text className='field-label'>{f.label}</Text>
            <Text className='field-value'>{f.value}</Text>
          </View>
        ))}
      </View>

      {/* 商品明细 */}
      {inv.items && inv.items.length > 0 && (
        <View className='info-card'>
          <Text className='section-title'>商品明细</Text>
          {(inv.items || []).map((item, idx) => (
            <View key={idx} className='item-row'>
              <Text className='item-name'>{item.item_name || '-'}</Text>
              <Text className='item-detail'>
                {item.quantity} × ¥{item.unit_price} = ¥{item.amount}
              </Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}
