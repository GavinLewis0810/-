import { useState } from 'react';
import { Modal, Button } from 'antd';
import { PrinterOutlined } from '@ant-design/icons';
import { QRCodeSVG } from 'qrcode.react';

interface Props {
  id: number;
  title: string;
  projectCode?: string | null;
  amount: number;
  submitter?: string | null;
  reviewer?: string | null;
  reviewNote?: string | null;
  bankCardInfo?: string | null;
  submitterSignature?: string | null;
  reviewerSignature?: string | null;
  items: Array<{
    item_name?: string | null;
    specification?: string | null;
    quantity?: string | null;
    unit_price?: string | null;
    amount?: string | null;
  }>;
  invoiceNumbers?: string[];
}

const voucherStyle: Record<string, React.CSSProperties> = {
  page: { fontFamily: 'SimSun, serif', color: '#000', fontSize: 13, lineHeight: 1.8, padding: 20 },
  header: { textAlign: 'center', marginBottom: 20 },
  qrWrap: { textAlign: 'right', marginBottom: 12 },
  table: { borderCollapse: 'collapse', width: '100%', margin: '10px 0' },
  td: { border: '1px solid #333', padding: '6px 10px', fontSize: 13 },
  th: { border: '1px solid #333', padding: '6px 10px', fontSize: 13, background: '#f5f5f5' },
  label: { fontWeight: 600, background: '#f9f9f9', width: '18%' },
  signArea: { display: 'flex', justifyContent: 'space-between', marginTop: 40 },
  signBox: { width: '45%' },
  signLine: { borderBottom: '1px solid #000', marginTop: 40 },
  footer: { textAlign: 'center', marginTop: 30, fontSize: 10, color: '#999' },
};

export default function PrintVoucher({
  id, title, projectCode, amount, submitter, reviewer, reviewNote,
  bankCardInfo, submitterSignature, reviewerSignature, items, invoiceNumbers,
}: Props) {
  const [open, setOpen] = useState(false);
  const [printDate, setPrintDate] = useState('');
  const qrValue = `REIMB-${id}\n金额: ¥${amount.toFixed(2)}\n${title}`;

  const handleOpen = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    setPrintDate(`${y}年${m}月${d}日`);
    setOpen(true);
  };

  const handlePrint = () => {
    const voucherEl = document.getElementById('voucher-print-area');
    if (!voucherEl) return;

    const printWin = window.open('', '_blank', 'width=800,height=600');
    if (!printWin) return;

    const voucherHTML = voucherEl.outerHTML;

    printWin.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>报销凭证</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: SimSun, serif; }
          @page { size: A4; margin: 12mm; }
        </style>
      </head>
      <body>${voucherHTML}</body>
      </html>
    `);
    printWin.document.close();
    printWin.focus();
    printWin.onafterprint = () => printWin.close();
    printWin.print();
  };

  const content = (
    <div style={voucherStyle.page} id="voucher-print-area">
      <div style={voucherStyle.header}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>智能发票报销管理系统</h2>
        <h3 style={{ margin: '8px 0 0', fontSize: 17, letterSpacing: 6 }}>报 销 凭 证</h3>
      </div>

      <div style={voucherStyle.qrWrap}>
        <QRCodeSVG value={qrValue} size={80} level="M" />
        <div style={{ fontSize: 9, color: '#999', marginTop: 2 }}>扫码追溯</div>
      </div>

      <table style={voucherStyle.table}>
        <tbody>
          <tr>
            <td style={voucherStyle.label}>报销单号</td><td>{id}</td>
            <td style={voucherStyle.label}>报销事由</td><td>{title}</td>
          </tr>
          <tr>
            <td style={voucherStyle.label}>项目编号</td><td>{projectCode || '-'}</td>
            <td style={voucherStyle.label}>报销金额</td><td style={{ fontWeight: 700, fontSize: 16 }}>¥{amount.toFixed(2)}</td>
          </tr>
          <tr>
            <td style={voucherStyle.label}>提交人</td><td>{submitter || '-'}</td>
            <td style={voucherStyle.label}>收款账户</td><td>{bankCardInfo || '-'}</td>
          </tr>
          <tr>
            <td style={voucherStyle.label}>审批人</td><td>{reviewer || '-'}</td>
            <td style={voucherStyle.label}>拨款账户</td><td>中国工商银行北京望京支行 (尾号0886)</td>
          </tr>
          {reviewNote && (
            <tr><td style={voucherStyle.label}>审批意见</td><td colSpan={3}>{reviewNote}</td></tr>
          )}
          {invoiceNumbers && invoiceNumbers.length > 0 && (
            <tr><td style={voucherStyle.label}>关联发票</td><td colSpan={3}>{invoiceNumbers.join('、')}</td></tr>
          )}
        </tbody>
      </table>

      {items.length > 0 && (
        <>
          <div style={{ fontWeight: 600, marginTop: 14, marginBottom: 6 }}>费用明细</div>
          <table style={voucherStyle.table}>
            <thead>
              <tr>
                <th style={voucherStyle.th}>名称</th><th style={voucherStyle.th}>规格</th>
                <th style={voucherStyle.th}>数量</th><th style={voucherStyle.th}>单价</th>
                <th style={voucherStyle.th}>金额</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={i}>
                  <td style={voucherStyle.td}>{item.item_name || '-'}</td>
                  <td style={voucherStyle.td}>{item.specification || '-'}</td>
                  <td style={voucherStyle.td}>{item.quantity || '-'}</td>
                  <td style={voucherStyle.td}>{item.unit_price || '-'}</td>
                  <td style={voucherStyle.td}>{item.amount || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <div style={voucherStyle.signArea}>
        <div style={voucherStyle.signBox}>
          <div>提交人签字：</div>
          {submitterSignature ? (
            <div style={{ textAlign: 'center', marginTop: 8 }}>
              <img src={submitterSignature} alt="提交人签名" style={{ maxWidth: '100%', maxHeight: 60 }} />
            </div>
          ) : (
            <div style={voucherStyle.signLine} />
          )}
          <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>日期：{printDate || '____年____月____日'}</div>
        </div>
        <div style={voucherStyle.signBox}>
          <div>财务总监签字：</div>
          {reviewerSignature ? (
            <div style={{ textAlign: 'center', marginTop: 8 }}>
              <img src={reviewerSignature} alt="审批人签名" style={{ maxWidth: '100%', maxHeight: 60 }} />
            </div>
          ) : (
            <div style={voucherStyle.signLine} />
          )}
          <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>日期：{printDate || '____年____月____日'}</div>
        </div>
      </div>

      <div style={voucherStyle.footer}>
        本凭证由智能发票报销管理系统自动生成 · 扫码可追溯报销单详情
      </div>
    </div>
  );

  return (
    <>
      <Button icon={<PrinterOutlined />} onClick={handleOpen}>打印报销凭证</Button>
      <Modal
        title="报销凭证预览"
        open={open}
        onCancel={() => setOpen(false)}
        width={750}
        footer={[
          <Button key="cancel" onClick={() => setOpen(false)}>关闭</Button>,
          <Button key="print" type="primary" icon={<PrinterOutlined />} onClick={handlePrint}>打印</Button>,
        ]}
      >
        {content}
      </Modal>
    </>
  );
}
