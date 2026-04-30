import React, { useState, useEffect } from 'react';
import { Table, Tag, Button, Space, message, Card } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { getReimbursements } from '../services/api';
import { Reimbursement, ReimbursementStatus } from '../types/invoice';

const ReimbursementListPage: React.FC = () => {
  const [data, setData] = useState<Reimbursement[]>([]);
  const [loading, setLoading] = useState(false);

  // 1. 获取报销单列表数据
  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await getReimbursements();
      setData(res);
    } catch (error) {
      message.error('获取报销单列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // 2. 根据状态生成不同颜色的 Tag
  const getStatusTag = (status: ReimbursementStatus) => {
    const statusMap: Record<string, string> = {
      [ReimbursementStatus.DRAFT]: 'default',      // 灰色
      [ReimbursementStatus.SUBMITTED]: 'warning',  // 橙色
      [ReimbursementStatus.APPROVED]: 'success',   // 绿色
      [ReimbursementStatus.REJECTED]: 'error',     // 红色
      [ReimbursementStatus.COMPLETED]: 'processing',// 蓝色
    };
    return <Tag color={statusMap[status] || 'default'}>{status}</Tag>;
  };

  // 3. 定义报销单主表格的列
  const columns: ColumnsType<Reimbursement> = [
    { title: '单号', dataIndex: 'id', key: 'id', width: 80 },
    { title: '报销事由', dataIndex: 'title', key: 'title' },
    { title: '项目编号', dataIndex: 'project_code', key: 'project_code', render: (val) => val || '-' },
    {
      title: '总金额',
      dataIndex: 'total_amount',
      key: 'total_amount',
      render: (val) => `¥${Number(val).toFixed(2)}`,
    },
    { title: '提交人', dataIndex: 'submitter', key: 'submitter', render: (val) => val || '当前用户' },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: ReimbursementStatus) => getStatusTag(status),
    },
    {
      title: '提交时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (val) => new Date(val).toLocaleString(),
    },
    {
      title: '操作',
      key: 'action',
      render: (_, record) => (
        <Space size="middle">
          {/* 这里预留了审批功能，你可以后续加上弹窗或者跳到详情页 */}
          <Button type="link" size="small">查看详情</Button>
          {record.status === ReimbursementStatus.SUBMITTED && (
            <Button type="link" size="small" danger>审批</Button>
          )}
        </Space>
      ),
    },
  ];

  // 4. 定义展开行的子表格（显示这张报销单里的所有发票）
  const expandedRowRender = (record: Reimbursement) => {
    const invoiceColumns = [
      { title: '发票号码', dataIndex: 'invoice_number', key: 'invoice_number' },
      { title: '开票日期', dataIndex: 'issue_date', key: 'issue_date' },
      { title: '项目名称', dataIndex: 'item_name', key: 'item_name' },
      {
        title: '金额',
        dataIndex: 'amount',
        key: 'amount',
        render: (val: any) => val ? `¥${Number(val).toFixed(2)}` : '-'
      },
    ];

    return (
      <Table
        columns={invoiceColumns}
        dataSource={record.invoices || []} // 从报销单中读取绑定的发票数组
        pagination={false}                 // 子表格不需要分页
        size="small"
        rowKey="id"
      />
    );
  };

  return (
    <Card title="报销单台账" style={{ margin: '24px' }}>
      <Table
        columns={columns}
        dataSource={data}
        rowKey="id"
        loading={loading}
        expandable={{ expandedRowRender }} // 开启行展开功能
      />
    </Card>
  );
};

export default ReimbursementListPage;