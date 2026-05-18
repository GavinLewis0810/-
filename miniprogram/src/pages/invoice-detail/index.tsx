import { useEffect, useState } from 'react';
import Taro, { useRouter } from '@tarojs/taro';
import { View, Text, ScrollView, Image } from '@tarojs/components';
import { getInvoice } from '../../services/api';
import type { Invoice } from '../../types';
import './index.scss';

const HOST_URL = 'http://10.105.12.33:18080';

export default function InvoiceDetailPage() {
  const { id } = useRouter().params;
  const [inv, setInv] = useState<Invoice | null>(null);

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
      <View className='invoice-detail-page'>
        <View className='loading-box'>
          <Text className='loading-spinner'></Text>
          <Text className='loading-text'>智能识别结果加载中...</Text>
        </View>
      </View>
    );
  }

  // 状态与大厂克制化状态色映射表
  const statusClassMap: Record<string, string> = {
    '已上传': 'upl', '解析中': 'proc', '待处理': 'pend',
    '已确认': 'conf', '已报销': 'reim', '待确认': 'pend',
  };

  const fields = [
    { label: '发票号码', value: inv.invoice_number || '-', isMono: true },
    { label: '开票日期', value: inv.issue_date || '-' },
    { label: '购买方', value: inv.buyer_name || '-' },
    { label: '销售方', value: inv.seller_name || '-' },
    { label: '价税合计', value: inv.total_with_tax != null ? `¥${Number(inv.total_with_tax).toLocaleString()}` : '-', isAmount: true },
    { label: '不含税金额', value: inv.amount != null ? `¥${Number(inv.amount).toLocaleString()}` : '-' },
    { label: '税率', value: inv.tax_rate || '-' },
    { label: '税额', value: inv.tax_amount != null ? `¥${Number(inv.tax_amount).toLocaleString()}` : '-' },
    { label: '状态', value: inv.status, isStatus: true },
    { label: '消费类别', value: inv.spend_category || '-' },
    { label: '碳足迹', value: inv.carbon_kg != null ? `${Number(inv.carbon_kg).toFixed(2)} kg CO₂` : '-', isCarbon: true },
  ];

  // 拼接好的真机可用图片链接
  const imageUrl = `${HOST_URL}/api/invoices/${inv.id}/file`;

  return (
    <ScrollView className='invoice-detail-page' scrollY>
      <View className='detail-container'>
        
        {/* 发票图片预览卡片 */}
        <View className='ui-card preview-card'>
          <View className='card-header-mini'>
            <Text className='header-title-text'>📄 原始凭证电子影像</Text>
            <Text className='header-action-text'>点击全屏查看</Text>
          </View>
          <View className='image-box' onClick={() => {
            Taro.previewImage({
              urls: [imageUrl],
            });
          }}>
            <Image
              className='invoice-preview-img'
              src={imageUrl}
              mode='widthFix'
            />
          </View>
        </View>

        {/* 字段信息卡片 */}
        <View className='ui-card info-card'>
          <View className='card-header-main'>
            <Text className='header-title-text'>🔍 智能结构化识别数据</Text>
          </View>
          
          <View className='fields-list'>
            {fields.map(f => (
              <View key={f.label} className={`field-row ${f.isAmount ? 'row-amount-highlight' : ''}`}>
                <Text className='field-label'>{f.label}</Text>
                
                {f.isStatus ? (
                  <Text className={`status-tag tag-${statusClassMap[inv.status] || 'pend'}`}>
                    {f.value}
                  </Text>
                ) : f.isCarbon ? (
                  <Text className='carbon-value-text'>🌱 {f.value}</Text>
                ) : (
                  <Text className={`field-value ${f.isMono ? 'font-mono' : ''} ${f.isAmount ? 'amount-text' : ''}`}>
                    {f.value}
                  </Text>
                )}
              </View>
            ))}
          </View>
        </View>

        {/* 商品明细卡片 */}
        {inv.items && inv.items.length > 0 && (
          <View className='ui-card items-card'>
            <View className='card-header-main'>
              <Text className='header-title-text'>📦 项目结算商品明细</Text>
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