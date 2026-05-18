import { useEffect, useState } from 'react';
import Taro from '@tarojs/taro';
import { View, Text, ScrollView, Input } from '@tarojs/components';
import { getBankCards, addBankCard, setDefaultBankCard, deleteBankCard, getTransactions } from '../../services/api';
import { isLoggedIn } from '../../services/auth';
import type { BankCardItem, TransactionItem } from '../../types';
import './index.scss';

export default function BankCardsPage() {
  const [cards, setCards] = useState<BankCardItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [bankName, setBankName] = useState('');
  const [accountName, setAccountName] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [adding, setAdding] = useState(false);
  const [activeTab, setActiveTab] = useState<'cards' | 'tx'>('cards');
  const [transactions, setTransactions] = useState<TransactionItem[]>([]);

  useEffect(() => {
    if (!isLoggedIn()) { Taro.reLaunch({ url: '/pages/index/index' }); return; }
    fetchData();
  }, []);

  const fetchData = async () => {
    try { setCards(await getBankCards()); } catch { /* */ }
    try { setTransactions(await getTransactions()); } catch { /* */ }
    finally { setLoading(false); }
  };

  const onRefresh = async () => {
    setRefreshing(true); await fetchData(); setRefreshing(false);
  };

  const handleAdd = async () => {
    if (!bankName.trim() || !accountName.trim() || !cardNumber.trim()) {
      Taro.showToast({ title: '请填写完整信息', icon: 'none' }); return;
    }
    setAdding(true);
    try {
      await addBankCard({ bank_name: bankName, account_name: accountName, card_number: cardNumber });
      Taro.showToast({ title: '添加成功', icon: 'success' });
      setShowAdd(false); setBankName(''); setAccountName(''); setCardNumber('');
      fetchData();
    } catch (e: any) { Taro.showToast({ title: e.message || '添加失败', icon: 'error' }); }
    finally { setAdding(false); }
  };

  const handleSetDefault = async (id: number) => {
    try { await setDefaultBankCard(id); fetchData(); }
    catch { Taro.showToast({ title: '设置失败', icon: 'error' }); }
  };

  const handleDelete = (id: number) => {
    Taro.showModal({
      title: '确认删除', content: '确定删除该银行卡吗？',
      success: async (res) => {
        if (res.confirm) {
          try { await deleteBankCard(id); Taro.showToast({ title: '已删除', icon: 'success' }); fetchData(); }
          catch { Taro.showToast({ title: '删除失败', icon: 'error' }); }
        }
      },
    });
  };

  const totalBalance = cards.reduce((s, c) => s + (c.balance || 0), 0);
  const txTypeColor: Record<string, string> = { '拨款': '#07c160', '报销到账': '#2f54eb', '借款冲销': '#ff9900' };

  return (
    <View className='bk-page'>
      <View className='bk-banner'>
        <View className='banner-top'>
          <Text className='banner-title'>收款账户</Text>
          <View className='add-btn' onClick={() => setShowAdd(true)}>
            <Text className='add-text'>+ 添加</Text>
          </View>
        </View>
        {/* 余额概览 */}
        {cards.length > 0 && (
          <View className='balance-row'>
            <View className='bal-item'>
              <Text className='bal-label'>账户余额</Text>
              <Text className='bal-value'>¥{totalBalance.toFixed(2)}</Text>
            </View>
            <View className='bal-divider' />
            <View className='bal-item'>
              <Text className='bal-label'>银行卡</Text>
              <Text className='bal-value'>{cards.length} 张</Text>
            </View>
            <View className='bal-divider' />
            <View className='bal-item'>
              <Text className='bal-label'>交易笔数</Text>
              <Text className='bal-value'>{transactions.length}</Text>
            </View>
          </View>
        )}
      </View>

      {/* Tab 切换 */}
      <View className='tab-row'>
        <View className={`tab-item ${activeTab === 'cards' ? 'tab-active' : ''}`} onClick={() => setActiveTab('cards')}>
          <Text className='tab-text'>我的银行卡</Text>
        </View>
        <View className={`tab-item ${activeTab === 'tx' ? 'tab-active' : ''}`} onClick={() => setActiveTab('tx')}>
          <Text className='tab-text'>资金流水</Text>
        </View>
      </View>

      <ScrollView
        scrollY className='bk-scroll'
        refresherEnabled refresherTriggered={refreshing}
        onRefresherRefresh={onRefresh}
      >
        <View className='bk-container'>
          {loading ? (
            <View className='empty-wrap'><Text className='empty-text'>加载中...</Text></View>
          ) : activeTab === 'cards' ? (
            cards.length === 0 ? (
              <View className='empty-wrap'>
                <View className='empty-icon-circle'><Text className='empty-icon'>🏦</Text></View>
                <Text className='empty-text'>暂无银行卡</Text>
                <Text className='empty-hint'>添加收款账户，用于接收报销款</Text>
              </View>
            ) : (
              cards.map(c => (
                <View key={c.id} className='bk-card'>
                  <View className='card-bank-info'>
                    <View className='bank-icon-wrap'>
                      <Text className='bank-icon'>🏦</Text>
                    </View>
                    <View className='bank-text'>
                      <Text className='bank-name'>{c.bank_name}</Text>
                      <Text className='bank-account'>{c.account_name} · ****{c.card_number.slice(-4)}</Text>
                    </View>
                    {c.is_default && <Text className='default-tag'>默认</Text>}
                  </View>
                  <View className='card-balance'>
                    <Text className='bal-amt'>¥{Number(c.balance || 0).toFixed(2)}</Text>
                  </View>
                  <View className='card-actions'>
                    {!c.is_default && (
                      <Text className='act-set' onClick={() => handleSetDefault(c.id)}>设为默认</Text>
                    )}
                    <Text className='act-del' onClick={() => handleDelete(c.id)}>删除</Text>
                  </View>
                </View>
              ))
            )
          ) : (
            transactions.length === 0 ? (
              <View className='empty-wrap'>
                <Text className='empty-text'>暂无交易流水</Text>
                <Text className='empty-hint'>拨款或报销到账后将在此显示</Text>
              </View>
            ) : (
              transactions.map(tx => (
                <View key={tx.id} className='tx-card'>
                  <View className='tx-left'>
                    <Text className='tx-type' style={{ color: txTypeColor[tx.type] || '#323233' }}>
                      {tx.type}
                    </Text>
                    <Text className='tx-note' numberOfLines={1}>{tx.note || '-'}</Text>
                    <Text className='tx-time'>{tx.created_at?.slice(0, 16)}</Text>
                  </View>
                  <View className='tx-right'>
                    <Text className='tx-amount' style={{ color: tx.amount >= 0 ? '#07c160' : '#E42313' }}>
                      {tx.amount >= 0 ? '+' : ''}¥{Number(tx.amount).toFixed(2)}
                    </Text>
                    <Text className='tx-balance'>余额 ¥{Number(tx.balance_after).toFixed(2)}</Text>
                  </View>
                </View>
              ))
            )
          )}
        </View>
      </ScrollView>

      {/* 添加银行卡弹窗 */}
      {showAdd && (
        <View className='modal-mask' onClick={() => setShowAdd(false)}>
          <View className='modal-card' onClick={e => e.stopPropagation()}>
            <Text className='modal-title'>添加银行卡</Text>
            <Input className='modal-input' placeholder='开户行（如：中国工商银行）' placeholderClass='ph' value={bankName} onInput={e => setBankName(e.detail.value)} />
            <Input className='modal-input' placeholder='持卡人姓名' placeholderClass='ph' value={accountName} onInput={e => setAccountName(e.detail.value)} />
            <Input className='modal-input' placeholder='银行卡号' placeholderClass='ph' maxlength={19} value={cardNumber} onInput={e => setCardNumber(e.detail.value)} />
            <View className='modal-btns'>
              <View className='modal-cancel' onClick={() => setShowAdd(false)}><Text>取消</Text></View>
              <View className='modal-ok' onClick={adding ? undefined : handleAdd}><Text>{adding ? '添加中...' : '添加'}</Text></View>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
